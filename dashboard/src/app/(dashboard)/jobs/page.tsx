'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false });
import { useAppStore } from '@/store/appStore';
import { createJob, updateJobStatus, updateCommandStatus, createCommandRecord } from '@/lib/db';
import { dispatchCommandToDevice, subscribeCommandResult, subscribeJobOutput, writeJobInitialLogs } from '@/lib/rtdb';
import { runScheduler, buildSchedulerConsoleLogs } from '@/lib/scheduler';
import { loadWeights, saveWeights, SchedulerWeightsPanel } from '@/components/SchedulerWeightsPanel';
import AiReportModal from '@/components/AiReportModal';
import { Component as AiLoader } from '@/components/ui/ai-loader';
import { DEFAULT_SCHEDULER_WEIGHTS } from '@/types';
import {
  Play, Loader2, Sparkles, Terminal as TerminalIcon, Code,
  History, Monitor, Cpu, ChevronRight, CheckCircle, XCircle,
  Clock, Plus, X, Network, Zap, Trash2, Users, Download, AlertTriangle,
  Settings2, Activity, Trophy, BarChart2
} from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import type { Job, SchedulerWeights, SchedulerDecision } from '@/types';

interface OutputLine { idx: number; text: string; ts: number; }

interface JobTab {
  id: string;
  name: string;
  code: string;
  mode: 'cluster' | 'dedicated';
  parallel: boolean;
  targetClusterId: string;
  targetDeviceId: string;
  forceWork: boolean;
}

const DEFAULT_CODE = `import numpy as np
import time

print("[ClusterOS] Starting model training simulation...")
print("[ClusterOS] Loading datasets...")

for epoch in range(1, 6):
    loss = 0.5 / epoch
    accuracy = 0.6 + (0.35 * (epoch / 5))
    print(f"Epoch {epoch}/5 - loss: {loss:.4f} - accuracy: {accuracy:.4f}")
    time.sleep(1.5)

print("[ClusterOS] Training complete!")
`;

let tabCounter = 1;
function createTab(isInitial = false): JobTab {
  return {
    id: isInitial ? 'tab_init' : `tab_${Date.now()}_${tabCounter++}`,
    name: `Job ${isInitial ? 1 : tabCounter - 1}`,
    code: DEFAULT_CODE,
    mode: 'cluster',
    parallel: false,
    targetClusterId: '',
    targetDeviceId: '',
    forceWork: false,
  };
}

const STATUS_STYLE: Record<string, { bg: string; text: string; icon: typeof CheckCircle; spin?: boolean }> = {
  queued:     { bg: 'bg-amber-500/10 border-amber-500/20',  text: 'text-amber-400',  icon: Clock },
  installing: { bg: 'bg-cyan-500/10 border-cyan-500/20',    text: 'text-cyan-400',   icon: Loader2, spin: true },
  running:    { bg: 'bg-blue-500/10 border-blue-500/20',    text: 'text-blue-400',   icon: Loader2, spin: true },
  completed:  { bg: 'bg-green-500/10 border-green-500/20',  text: 'text-green-400',  icon: CheckCircle },
  failed:     { bg: 'bg-red-500/10 border-red-500/20',      text: 'text-red-400',    icon: XCircle },
};

export default function JobsPage() {
  const { user: authUser } = useAuth();
  const { jobs, devices, clusters, metricsMap, user } = useAppStore();
  const ownerId = user?.uid ?? authUser?.uid ?? null;

  // ─── Derived ──────────────────────────────────────────────────────────────
  const onlineDevices = devices.filter(d => metricsMap[d.deviceId]?.status === 'online');

  // ─── Tab state ────────────────────────────────────────────────────────────
  const [tabs, setTabs] = useState<JobTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');

  useEffect(() => {
    const initialTab = createTab(true);
    setTabs([initialTab]);
    setActiveTabId(initialTab.id);
  }, []);

  const activeTab = tabs.find(t => t.id === activeTabId) ?? {
    id: 'tab_init',
    name: 'Job 1',
    code: DEFAULT_CODE,
    mode: 'cluster' as const,
    parallel: false,
    targetClusterId: '',
    targetDeviceId: '',
    forceWork: false,
  };

  const updateTab = (patch: Partial<JobTab>) =>
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, ...patch } : t));

  const addTab = () => { const tab = createTab(); setTabs(prev => [...prev, tab]); setActiveTabId(tab.id); };
  const removeTab = (tabId: string) => {
    setTabs(prev => {
      const remaining = prev.filter(t => t.id !== tabId);
      if (remaining.length === 0) { const fresh = createTab(); setActiveTabId(fresh.id); return [fresh]; }
      if (activeTabId === tabId) setActiveTabId(remaining[remaining.length - 1].id);
      return remaining;
    });
  };

  // ─── Cluster URL param ────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const clusterId = params.get('clusterId');
      if (clusterId) updateTab({ mode: 'cluster', targetClusterId: clusterId });
    }
  }, [activeTabId]);

  // ─── Console & AI state ───────────────────────────────────────────────────
  const [activeConsoleJobId, setActiveConsoleJobId] = useState<string | null>(null);
  const [activeConsoleDeviceId, setActiveConsoleDeviceId] = useState<string>('');
  const [consoleDeviceIds, setConsoleDeviceIds] = useState<string[]>([]);
  const [activeConsoleLines, setActiveConsoleLines] = useState<OutputLine[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [runningTabs, setRunningTabs] = useState<Set<string>>(new Set());
  const [targetDeviceNames, setTargetDeviceNames] = useState<Record<string, string>>({});
  const [consoleActiveTab, setConsoleActiveTab] = useState<'terminal' | 'report'>('terminal');
  const [aiReportModalJob, setAiReportModalJob] = useState<Job | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const isRunning = runningTabs.has(activeTabId);

  // ─── Scheduler weights state ──────────────────────────────────────────────
  const [schedulerWeights, setSchedulerWeights] = useState<SchedulerWeights>(DEFAULT_SCHEDULER_WEIGHTS);
  const [showWeightsPanel, setShowWeightsPanel] = useState(false);

  useEffect(() => {
    setSchedulerWeights(loadWeights());
  }, []);

  const handleWeightsChange = useCallback((w: SchedulerWeights) => {
    setSchedulerWeights(w);
    saveWeights(w);
  }, []);

  const terminalScrollRef = useRef<HTMLDivElement>(null);
  const outputUnsubRef = useRef<(() => void) | null>(null);
  const commandUnsubsRef = useRef<Record<string, (() => void)[]>>({});

  useEffect(() => {
    if (terminalScrollRef.current) {
      terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight;
    }
  }, [activeConsoleLines]);

  useEffect(() => {
    if (outputUnsubRef.current) { outputUnsubRef.current(); outputUnsubRef.current = null; }
    setActiveConsoleLines([]);
    if (activeConsoleJobId && activeConsoleDeviceId) {
      const cmdId = `job_${activeConsoleJobId}_${activeConsoleDeviceId}`;
      const unsub = subscribeJobOutput(activeConsoleDeviceId, cmdId, (lines) => setActiveConsoleLines(lines));
      outputUnsubRef.current = unsub;
    }
    return () => { if (outputUnsubRef.current) { outputUnsubRef.current(); outputUnsubRef.current = null; } };
  }, [activeConsoleJobId, activeConsoleDeviceId]);

  useEffect(() => () => { Object.values(commandUnsubsRef.current).forEach(unsubs => unsubs.forEach(fn => fn())); }, []);

  // ─── Dispatch a single device ─────────────────────────────────────────────
  const dispatchSingleDevice = async (tabId: string, jobId: string, deviceId: string, code: string, forceWork: boolean) => {
    const cmdId = `job_${jobId}_${deviceId}`;
    const dev = devices.find(x => x.deviceId === deviceId);
    const devName = dev?.name || dev?.machineName || deviceId;
    if (ownerId) await createCommandRecord(cmdId, deviceId, devName, 'run_script', { script: code, forceWork }, ownerId);
    await dispatchCommandToDevice(deviceId, cmdId, 'run_script', { script: code, forceWork });
    await updateJobStatus(jobId, 'running');

    const timeoutTimer = setTimeout(async () => {
      unsubResult();
      await updateJobStatus(jobId, 'failed', 'Timed out after 10 minutes.');
      setRunningTabs(prev => { const s = new Set(prev); s.delete(tabId); return s; });
    }, 600_000);

    const unsubResult = subscribeCommandResult(deviceId, cmdId, async (result) => {
      if (!result) return;
      if (result.status === 'installing') await updateJobStatus(jobId, 'installing');
      else if (result.status === 'running') await updateJobStatus(jobId, 'running');
      else if (result.status === 'success' || result.status === 'failed') {
        clearTimeout(timeoutTimer); unsubResult();
        const ok = result.status === 'success';
        await updateCommandStatus(cmdId, ok ? 'success' : 'failed', result.output ?? '', result.completedAt ?? Date.now());
        await updateJobStatus(jobId, ok ? 'completed' : 'failed', result.output ?? '');
        setRunningTabs(prev => { const s = new Set(prev); s.delete(tabId); return s; });
      }
    });

    if (!commandUnsubsRef.current[tabId]) commandUnsubsRef.current[tabId] = [];
    commandUnsubsRef.current[tabId].push(unsubResult);
  };

  // ─── Main Run Handler ─────────────────────────────────────────────────────
  const handleRun = async () => {
    if (!ownerId) {
      alert('You must be signed in to run workloads. Please refresh and log in again.');
      return;
    }
    const tab = activeTab;
    const tabId = tab.id;

    // Validate before showing loader
    if (tab.mode === 'dedicated' && !tab.targetDeviceId) {
      alert('Please select a target device.');
      return;
    }

    if (commandUnsubsRef.current[tabId]) {
      commandUnsubsRef.current[tabId].forEach(fn => fn());
      commandUnsubsRef.current[tabId] = [];
    }

    setIsAnalyzing(true);
    try {
      let targetDeviceIds: string[] = [];
      let label = '';
      let schedulerDecision: SchedulerDecision | null = null;

      if (tab.mode === 'dedicated') {
        targetDeviceIds = [tab.targetDeviceId];
        const d = devices.find(x => x.deviceId === tab.targetDeviceId);
        label = d?.name || d?.machineName || tab.targetDeviceId;

        const poolDeviceIds = tab.targetClusterId
          ? clusters.find(c => c.id === tab.targetClusterId)?.deviceIds
          : undefined;

        const fullDecision = runScheduler(
          devices,
          metricsMap,
          poolDeviceIds,
          schedulerWeights
        );

        if (fullDecision) {
          const selectedNode = fullDecision.rankedNodes.find(n => n.deviceId === tab.targetDeviceId)
            || fullDecision.eliminatedNodes.find(n => n.deviceId === tab.targetDeviceId);

          let newRanked = [...fullDecision.rankedNodes];
          if (selectedNode && !selectedNode.eliminated) {
            newRanked = [
              selectedNode,
              ...fullDecision.rankedNodes.filter(n => n.deviceId !== tab.targetDeviceId)
            ];
          }

          schedulerDecision = {
            ...fullDecision,
            selectedDeviceId: tab.targetDeviceId,
            selectedDeviceName: label,
            finalScore: selectedNode ? selectedNode.finalScore : 0,
            rankedNodes: newRanked,
            routingReason: `Manual dedicated routing. User explicitly selected node: ${label}.`,
            positiveFacts: ['User manually selected this node for dedicated execution.'],
          };
        } else {
          schedulerDecision = {
            timestamp: Date.now(),
            selectedDeviceId: tab.targetDeviceId,
            selectedDeviceName: label,
            finalScore: 0,
            rank: 1,
            totalConsidered: 1,
            confidence: 100,
            routingReason: `Manual dedicated routing. User explicitly selected node: ${label}.`,
            positiveFacts: ['User manually selected this node for dedicated execution.'],
            tiebroken: false,
            weights: schedulerWeights,
            rankedNodes: [],
            eliminatedNodes: [],
            expectedCompletionMinutes: 10,
          };
        }
      } else {
        const cluster = clusters.find(c => c.id === tab.targetClusterId);
        const clusterDeviceIds = cluster?.deviceIds ?? [];
        const poolIds = clusterDeviceIds.length > 0 ? clusterDeviceIds : undefined;

        if (tab.parallel && (clusterDeviceIds.length > 0 || devices.length > 0)) {
          const onlinePool = devices.filter(d =>
            (poolIds ? poolIds.includes(d.deviceId) : true) &&
            metricsMap[d.deviceId]?.status === 'online'
          );
          targetDeviceIds = onlinePool.map(d => d.deviceId);
          label = `${cluster?.name ?? 'Cluster'} — ${targetDeviceIds.length} nodes parallel`;

          schedulerDecision = runScheduler(devices, metricsMap, poolIds, schedulerWeights);
          if (schedulerDecision) {
            schedulerDecision = {
              ...schedulerDecision,
              routingReason: `Parallel group execution mode. Workload dispatched simultaneously to all ${targetDeviceIds.length} online nodes in ${cluster?.name ?? 'the cluster'}. ${schedulerDecision.routingReason}`,
            };
          }
        } else {
          schedulerDecision = runScheduler(devices, metricsMap, poolIds, schedulerWeights);
          if (!schedulerDecision) { alert('No healthy nodes found. Ensure the agent is running and nodes are online.'); return; }
          targetDeviceIds = [schedulerDecision.selectedDeviceId];
          label = `${schedulerDecision.selectedDeviceName} (auto — score ${schedulerDecision.finalScore.toFixed(1)})`;
        }
      }

      if (targetDeviceIds.length === 0) { alert('No online target devices found.'); return; }

      setRunningTabs(prev => new Set(prev).add(tabId));
      setTargetDeviceNames(prev => ({ ...prev, [tabId]: label }));

      const finalDecision = schedulerDecision ?? {
        timestamp: Date.now(),
        selectedDeviceId: targetDeviceIds[0],
        selectedDeviceName: label,
        finalScore: 0,
        rank: 1,
        totalConsidered: targetDeviceIds.length,
        confidence: 100,
        routingReason: label,
        positiveFacts: [],
        tiebroken: false,
        weights: schedulerWeights,
        rankedNodes: [],
        eliminatedNodes: devices.map(d => ({
          deviceId: d.deviceId,
          deviceName: d.name || d.machineName,
          cpuUsage: 0, ramUsage: 0, gpuUsage: 0, cpuTemp: 0, gpuTemp: 0, latencyMs: 0, runningTasks: 0, waitingTasks: 0, diskUsage: 0, successRate: 80, batteryPercent: null, powerPluggedIn: null, uptimeHours: 0, diskReadMbps: 0, diskWriteMbps: 0, downloadMbps: 0, uploadMbps: 0,
          cpuScore: 0, ramScore: 0, gpuScore: 0, temperatureScore: 0, networkScore: 0, queueScore: 0, reliabilityScore: 0, diskScore: 0, finalScore: 0, averagePerformance: 0,
          status: 'offline' as const, healthStatus: 'critical', eliminated: true, eliminationReason: 'Node is offline'
        })),
      };

      const jobId = await createJob({
        name: tab.name,
        type: 'python',
        script: tab.code,
        targetDeviceIds,
        status: 'queued',
        ownerId,
        createdAt: Date.now(),
        priority: 1,
        forceWork: tab.forceWork,
        aiReport: finalDecision,
      });

      const primaryDeviceId = targetDeviceIds[0];
      const cmdId = `job_${jobId}_${primaryDeviceId}`;

      const consoleLogs = finalDecision.rankedNodes.length > 0
        ? buildSchedulerConsoleLogs(finalDecision)
        : [
            `[ClusterOS] Dispatching workload to: ${label}`,
            tab.forceWork ? `[ClusterOS] FORCE WORK active: Background cleanup requested.` : `[ClusterOS] Standard resource allocation.`,
            `[ClusterOS] Sending script to agent...\n`,
          ];
      if (tab.forceWork) consoleLogs.push(`[ClusterOS] FORCE WORK active: Terminating heavy background apps before execution.`);

      setSelectedJob(null);
      setActiveConsoleJobId(jobId);
      setConsoleDeviceIds(targetDeviceIds);
      setActiveConsoleDeviceId(primaryDeviceId);
      setConsoleActiveTab('terminal');

      if (tab.parallel && targetDeviceIds.length > 1) {
        await Promise.all(targetDeviceIds.map(did => dispatchSingleDevice(tabId, jobId, did, tab.code, tab.forceWork)));
      } else {
        await dispatchSingleDevice(tabId, jobId, primaryDeviceId, tab.code, tab.forceWork);
      }
    } catch (err) {
      console.error('Run workload failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to dispatch workload. Check console for details.');
      setRunningTabs(prev => { const s = new Set(prev); s.delete(tabId); return s; });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const viewJobLogs = (job: Job) => {
    setSelectedJob(job);
    setActiveConsoleJobId(job.id);
    setConsoleDeviceIds(job.targetDeviceIds ?? []);
    setActiveConsoleDeviceId((job.targetDeviceIds ?? [])[0] ?? '');
    setConsoleActiveTab('terminal');
  };

  const downloadLogs = (formatType: 'txt' | 'csv') => {
    if (activeConsoleLines.length === 0) return;
    let content = '';
    const filename = `job_${activeConsoleJobId}_node_${activeConsoleDeviceId}`;
    if (formatType === 'csv') {
      content = 'Index,Timestamp,Log Line\n';
      activeConsoleLines.forEach(line => {
        content += `${line.idx},"${format(new Date(line.ts), 'yyyy-MM-dd HH:mm:ss')}","${line.text.replace(/"/g, '""')}"\n`;
      });
    } else {
      content = activeConsoleLines.map(l => l.text).join('\n');
    }
    const blob = new Blob([content], { type: formatType === 'csv' ? 'text/csv' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.${formatType}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const currentJobForConsole = selectedJob ?? jobs.find(j => j.id === activeConsoleJobId);

  return (
    <div className="space-y-5">
      {/* AI Report Modal */}
      <AnimatePresence>
        {aiReportModalJob?.aiReport && (
          <AiReportModal
            decision={aiReportModalJob.aiReport}
            jobName={aiReportModalJob.name}
            jobId={aiReportModalJob.id}
            onClose={() => setAiReportModalJob(null)}
          />
        )}
      </AnimatePresence>

      {/* AI Loading Animation */}
      <AnimatePresence>
        {isAnalyzing && (
          <AiLoader text="ANALYZING" />
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-green-400" />
            AI Workload Studio
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Intelligent scheduler · Multi-factor scoring · Explainable dispatch
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowWeightsPanel(v => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs font-semibold transition-all ${
              showWeightsPanel
                ? 'bg-violet-500/10 border-violet-500/30 text-violet-400'
                : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5" />
            Scheduler Config
          </button>
          <span className="flex items-center gap-2 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-400">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            {onlineDevices.length} nodes ready
          </span>
        </div>
      </div>

      {/* Scheduler Weights Panel */}
      <AnimatePresence>
        {showWeightsPanel && (
          <SchedulerWeightsPanel
            weights={schedulerWeights}
            onChange={handleWeightsChange}
            onClose={() => setShowWeightsPanel(false)}
          />
        )}
      </AnimatePresence>

      {/* ─── Job Tabs ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {tabs.map(tab => (
          <div
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={`group flex items-center gap-2 px-3 py-1.5 rounded-t-lg border-b-2 cursor-pointer text-sm whitespace-nowrap transition-all ${
              tab.id === activeTabId
                ? 'bg-slate-900 border-green-500 text-white'
                : 'bg-slate-900/30 border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-900/60'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            <span className="max-w-[120px] truncate">{tab.name}</span>
            {runningTabs.has(tab.id) && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
            {tabs.length > 1 && (
              <button onClick={e => { e.stopPropagation(); removeTab(tab.id); }} className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        <button onClick={addTab} className="flex items-center gap-1 px-2.5 py-1.5 text-slate-500 hover:text-green-400 hover:bg-slate-900/60 rounded-lg text-xs transition-all">
          <Plus className="w-3.5 h-3.5" /> Add Job
        </button>
      </div>

      {/* ─── Main IDE layout ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

        {/* Editor */}
        <div className="xl:col-span-2 flex flex-col gap-3">
          {/* Toolbar */}
          <div className="glass-card px-4 py-3 border border-slate-800 flex flex-col gap-3">
            {/* Row 1: Name + Force Work + Run */}
            <div className="flex items-center justify-between gap-3">
              <input
                type="text"
                value={activeTab.name}
                onChange={e => updateTab({ name: e.target.value })}
                className="bg-transparent border-none outline-none font-semibold text-sm text-white focus:ring-1 focus:ring-green-500/20 rounded px-1 flex-1"
                placeholder="Job name..."
              />
              <div className="flex items-center gap-4">
                <div
                  onClick={() => updateTab({ forceWork: !activeTab.forceWork })}
                  className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-red-400/90 hover:text-red-400 transition-colors select-none"
                >
                  <div
                    className={`w-8 h-4 rounded-full relative transition-colors ${activeTab.forceWork ? 'bg-red-500' : 'bg-slate-700'}`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${activeTab.forceWork ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Force Work
                </div>
                <button
                  onClick={handleRun}
                  disabled={isRunning || onlineDevices.length === 0}
                  className="flex items-center gap-2 px-4 py-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold rounded-lg text-xs transition-all uppercase tracking-wide"
                >
                  {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-black" />}
                  {isRunning ? 'Running...' : 'Run Workload'}
                </button>
              </div>
            </div>

            {/* Row 2: Target Mode */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1 bg-slate-950/60 rounded-lg p-1">
                <button
                  onClick={() => updateTab({ mode: 'cluster' })}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    activeTab.mode === 'cluster' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Network className="w-3.5 h-3.5" />
                  Cluster (Smart)
                </button>
                <button
                  onClick={() => updateTab({ mode: 'dedicated' })}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    activeTab.mode === 'dedicated' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  Dedicated PC
                </button>
              </div>

              {activeTab.mode === 'cluster' && (
                <>
                  <select
                    value={activeTab.targetClusterId}
                    onChange={e => updateTab({ targetClusterId: e.target.value })}
                    className="px-3 py-1.5 bg-slate-900/60 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-green-500/40 appearance-none"
                  >
                    <option value="">All Devices (Best Node)</option>
                    {clusters.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({(c.deviceIds ?? []).length} devices)</option>
                    ))}
                  </select>
                  <div
                    onClick={() => updateTab({ parallel: !activeTab.parallel })}
                    className="flex items-center gap-2 cursor-pointer text-xs text-slate-400 hover:text-slate-200 transition-colors select-none"
                  >
                    <div
                      className={`w-8 h-4 rounded-full relative transition-colors ${activeTab.parallel ? 'bg-green-500' : 'bg-slate-700'}`}
                    >
                      <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${activeTab.parallel ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                    <Users className="w-3 h-3" />
                    All Nodes Parallel
                  </div>
                </>
              )}

              {activeTab.mode === 'dedicated' && (
                <select
                  value={activeTab.targetDeviceId}
                  onChange={e => updateTab({ targetDeviceId: e.target.value })}
                  className="px-3 py-1.5 bg-slate-900/60 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500/40 appearance-none"
                >
                  <option value="">Select PC...</option>
                  {onlineDevices.map(d => {
                    const cpu = metricsMap[d.deviceId]?.cpu?.total ?? 0;
                    return <option key={d.deviceId} value={d.deviceId}>{d.name || d.machineName} — CPU: {Number(cpu).toFixed(0)}%</option>;
                  })}
                </select>
              )}

              {targetDeviceNames[activeTabId] && (
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <Zap className="w-3 h-3 text-green-400" />
                  {targetDeviceNames[activeTabId]}
                </span>
              )}
            </div>
          </div>

          {/* Monaco Editor */}
          <div className="glass-card overflow-hidden border border-slate-800 flex flex-col" style={{ height: 460 }}>
            <Editor
              height="100%"
              defaultLanguage="python"
              value={activeTab.code}
              onChange={v => updateTab({ code: v ?? '' })}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineHeight: 20,
                fontFamily: 'Fira Code, JetBrains Mono, Consolas, monospace',
                automaticLayout: true,
                padding: { top: 12 },
              }}
            />
          </div>
        </div>

        {/* Console & Report Side Panel */}
        <div className="flex flex-col gap-3">
          <div className="glass-card border border-slate-800 bg-[#050814] flex flex-col overflow-hidden" style={{ height: 560 }}>
            {/* Tab switch header */}
            <div className="bg-slate-950/80 px-2 py-1.5 border-b border-slate-800/80 flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setConsoleActiveTab('terminal')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  consoleActiveTab === 'terminal' ? 'bg-slate-900 text-green-400 border border-slate-800' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <TerminalIcon className="w-3.5 h-3.5" />
                Live Console
              </button>
              {currentJobForConsole?.aiReport && (
                <button
                  onClick={() => setAiReportModalJob(currentJobForConsole)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 border border-transparent hover:border-violet-500/20"
                >
                  <Activity className="w-3.5 h-3.5" />
                  AI Report ↗
                </button>
              )}
            </div>

            {/* Console view */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="bg-slate-950/40 border-b border-slate-850 px-4 py-2 flex items-center justify-between flex-shrink-0">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Terminal Log Output</span>
                {activeConsoleLines.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => downloadLogs('txt')} className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[9px] font-semibold transition-all">
                      <Download className="w-2.5 h-2.5" /> TXT
                    </button>
                    <button onClick={() => downloadLogs('csv')} className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[9px] font-semibold transition-all">
                      <Download className="w-2.5 h-2.5" /> CSV
                    </button>
                  </div>
                )}
              </div>

              {/* Device tabs (multi-node) */}
              {consoleDeviceIds.length > 1 && (
                <div className="flex items-center gap-1 bg-slate-950/20 border-b border-slate-850/60 px-2 py-1 flex-shrink-0 overflow-x-auto scrollbar-none">
                  {consoleDeviceIds.map(did => {
                    const devDoc = devices.find(d => d.deviceId === did);
                    const lbl = devDoc?.name || devDoc?.machineName || did;
                    const isActive = activeConsoleDeviceId === did;
                    return (
                      <button key={did} onClick={() => setActiveConsoleDeviceId(did)}
                        className={`px-2 py-1 rounded text-[10px] font-mono font-medium transition-all ${
                          isActive ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-slate-900/40 text-slate-500 border border-transparent hover:text-slate-300'
                        }`}
                      >
                        {lbl}
                      </button>
                    );
                  })}
                </div>
              )}

              <div ref={terminalScrollRef} className="flex-1 p-4 overflow-y-auto font-mono text-xs space-y-0.5 select-text scrollbar-thin">
                {activeConsoleLines.length === 0 ? (
                  activeConsoleJobId ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center py-8">
                      <Loader2 className="w-8 h-8 text-green-400 animate-spin mb-3" />
                      <p className="font-semibold text-green-400 tracking-wide text-xs">DISPATCHING WORKLOAD</p>
                      <p className="text-[10px] text-slate-500 mt-1">Waiting for agent to initialize execution...</p>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 text-center">
                      <TerminalIcon className="w-8 h-8 mb-2 opacity-20" />
                      <p>Console Idle</p>
                      <p className="text-[10px] opacity-60 mt-1">Press Run Workload or select a past job below</p>
                    </div>
                  )
                ) : (
                  activeConsoleLines
                    .filter(line => {
                      const t = line.text.trim();
                      if (!t) return false;
                      // Filter out remaining pip noise not caught by agent
                      if (t.startsWith('Requirement already satisfied') || t.startsWith('[pip] Requirement')) return false;
                      if (t.startsWith('[pip] Downloading') || (t.startsWith('Downloading') && (t.endsWith('.whl') || t.endsWith('.gz') || t.includes('/packages/')))) return false;
                      if (t.startsWith('Using cached') || t.startsWith('[pip] Using cached')) return false;
                      if (t.startsWith('Obtaining') || t.startsWith('[pip] Obtaining')) return false;
                      if (t.includes('━━') || t.includes('───')) return false;
                      if (t.includes('kB/s') || t.includes('MB/s')) return false;
                      if (t.startsWith('Notice:')) return false;
                      return true;
                    })
                    .map(line => {
                      const t = line.text.trim();
                      let cls = 'text-slate-200';
                      let prefix = '';
                      if (t.startsWith('[ClusterOS Scheduler]')) {
                        cls = 'text-violet-300 font-semibold';
                      } else if (t.startsWith('[ClusterOS]')) {
                        cls = 'text-green-400 font-semibold';
                      } else if (t.startsWith('[pip]')) {
                        cls = 'text-cyan-400/80';
                      } else if (t.startsWith('ERROR:') || t.includes('WARNING') || t.startsWith('Traceback') || t.includes('Error:')) {
                        cls = 'text-red-400 font-semibold';
                      } else if (t.startsWith('Successfully installed')) {
                        cls = 'text-emerald-400';
                      } else {
                        // Actual script output — slightly brighter
                        cls = 'text-slate-100';
                        prefix = '› ';
                      }
                      return (
                        <div key={line.idx} className={`leading-5 whitespace-pre-wrap ${cls}`}>
                          {prefix}{line.text}
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Workload History ─────────────────────────────────────────── */}
      <div className="glass-card p-5 border border-slate-800/80">
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <History className="w-4 h-4 text-green-400" />
          Workload History
          <span className="ml-auto text-xs text-slate-500">{jobs.length} total</span>
        </h2>
        {jobs.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">No workloads dispatched yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {[...jobs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 12).map(job => {
              const style = STATUS_STYLE[job.status] ?? STATUS_STYLE.queued;
              const StatusIcon = style.icon;
              const isSelected = selectedJob?.id === job.id;
              const deviceId = (job.targetDeviceIds ?? [])[0];
              const targetNode = devices.find(d => d.deviceId === deviceId);
              const nodeName = job.targetDeviceIds?.length > 1
                ? `${job.targetDeviceIds.length} nodes (parallel)`
                : (targetNode?.name || targetNode?.machineName || 'Unknown');

              return (
                <div
                  key={job.id}
                  onClick={() => { updateTab({ code: job.script, name: job.name, forceWork: job.forceWork ?? false }); viewJobLogs(job); }}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-2.5 ${
                    isSelected
                      ? 'bg-slate-900 border-green-500/30 shadow-[0_0_12px_rgba(34,197,94,0.05)]'
                      : 'bg-slate-950/40 border-slate-900 hover:bg-slate-900/40 hover:border-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-white truncate">{job.name}</p>
                      <p className="text-[10px] text-slate-500">{format(new Date(job.createdAt), 'MMM d, HH:mm')}</p>
                    </div>
                    <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${style.bg} ${style.text}`}>
                      <StatusIcon className={`w-3 h-3 ${style.spin ? 'animate-spin' : ''}`} />
                      {job.status}
                    </span>
                  </div>

                  {/* Score badge if AI report exists */}
                  {job.aiReport && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-violet-400 font-semibold">
                        <Trophy className="w-2.5 h-2.5" />
                        Score {Number(job.aiReport.finalScore ?? 0).toFixed(1)}
                      </span>
                      <span className="text-[9px] text-slate-600">Conf: {job.aiReport.confidence}%</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs border-t border-slate-900 pt-2 text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <Cpu className="w-3 h-3" />{nodeName}
                    </span>
                    <div className="flex items-center gap-2">
                      {job.aiReport && (
                        <button
                          onClick={e => { e.stopPropagation(); setAiReportModalJob(job); }}
                          className="flex items-center gap-0.5 text-[9px] text-violet-400 hover:text-violet-300 transition-colors"
                        >
                          <Activity className="w-2.5 h-2.5" /> Report
                        </button>
                      )}
                      <span className="text-[10px] flex items-center gap-0.5 text-slate-600">
                        Logs <ChevronRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
