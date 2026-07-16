'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Trophy, BarChart2, ShieldCheck, Clock, Activity, Cpu, AlertTriangle, Download, Loader2 } from 'lucide-react';
import type { SchedulerDecision } from '@/types';
import type { AIAnalysisReport } from '@/lib/groqAnalysis';
import { exportToPDF } from '@/components/AiReportModal';

interface InlineAiAnalysisProps {
  decision: SchedulerDecision;
  jobName?: string;
}

export function InlineAiAnalysis({ decision, jobName = 'Notebook Run' }: InlineAiAnalysisProps) {
  const [aiReport, setAiReport] = useState<AIAnalysisReport | null>(null);
  const [aiLoading, setAiLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Fetch AI Report details on mount
  useEffect(() => {
    let cancelled = false;
    setAiLoading(true);

    const winner = decision.rankedNodes[0];
    const runnerUp = decision.rankedNodes[1];

    const mappedScores = decision.rankedNodes.map(n => ({
      ...n,
      nodeId: n.deviceId,
      hostname: n.deviceName,
      rank: decision.rankedNodes.findIndex(r => r.deviceId === n.deviceId) + 1,
      metrics: {
        cpuUsage: n.cpuUsage,
        ramUsage: n.ramUsage,
        gpuUsage: n.gpuUsage,
        cpuTemp: n.cpuTemp,
        gpuTemp: n.gpuTemp,
        latencyMs: n.latencyMs,
        downloadMbps: n.downloadMbps,
        diskUsage: n.diskUsage,
        diskReadMbps: n.diskReadMbps,
        diskWriteMbps: n.diskWriteMbps,
        runningTasks: n.runningTasks,
        waitingTasks: n.waitingTasks,
      },
      components: {
        cpu: n.cpuScore,
        ram: n.ramScore,
        gpu: n.gpuScore,
        temp: n.temperatureScore,
        network: n.networkScore,
        queue: n.queueScore,
        reliability: n.reliabilityScore,
        disk: n.diskScore,
      },
      totalScore: n.finalScore,
      averagePerformance: n.averagePerformance,
    }));

    const decisionForAI = {
      ...decision,
      decisionId: String(decision.timestamp),
      selectedNode: mappedScores[0] || null,
      allScores: mappedScores,
      eliminatedNodes: decision.eliminatedNodes.map(n => ({
        ...n,
        nodeId: n.deviceId,
        hostname: n.deviceName,
        reason: n.eliminationReason ?? 'Unknown',
      })),
      scoreMargin: winner && runnerUp ? winner.finalScore - runnerUp.finalScore : 0,
      tiebreakerUsed: decision.tiebroken ? decision.tiebreakMethod : null,
    };

    import('@/lib/groqAnalysis').then(({ generateAIAnalysis }) => {
      generateAIAnalysis(decisionForAI as any)
        .then(report => {
          if (!cancelled) {
            setAiReport(report);
            setAiLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setAiLoading(false);
          }
        });
    });

    return () => { cancelled = true; };
  }, [decision]);

  const handlePDFExport = useCallback(async () => {
    setPdfLoading(true);
    try {
      await exportToPDF(decision, aiReport, jobName);
    } finally {
      setPdfLoading(false);
    }
  }, [decision, aiReport, jobName]);

  const winnerNode = decision.rankedNodes.find(n => n.deviceId === decision.selectedDeviceId) || decision.rankedNodes[0];

  return (
    <div className="space-y-4 p-4 text-xs font-sans text-slate-350 select-none">
      {/* Header with Export Button */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-2">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Scheduler Decision report</span>
        <button
          onClick={handlePDFExport}
          disabled={pdfLoading || aiLoading}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-violet-600/10 hover:bg-violet-600/20 text-violet-400 border border-violet-500/20 rounded-md text-[10px] font-bold transition-all disabled:opacity-50"
        >
          {pdfLoading ? (
            <Loader2 className="w-3 h-3 animate-spin text-violet-400" />
          ) : (
            <Download className="w-3 h-3" />
          )}
          {pdfLoading ? 'Exporting...' : 'Download PDF Report'}
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-cyan-950/20 border border-cyan-500/20 rounded-lg p-2 flex flex-col justify-between">
          <span className="text-[9px] text-cyan-400 font-extrabold uppercase tracking-wider">Selected Node</span>
          <span className="text-sm font-bold text-white truncate">{winnerNode?.deviceName || 'Unknown'}</span>
        </div>
        <div className="bg-violet-950/20 border border-violet-500/20 rounded-lg p-2 flex flex-col justify-between">
          <span className="text-[9px] text-violet-400 font-extrabold uppercase tracking-wider">Final Score</span>
          <span className="text-sm font-bold text-white">{decision.finalScore.toFixed(1)}/100</span>
        </div>
        <div className="bg-indigo-950/20 border border-indigo-500/20 rounded-lg p-2 flex flex-col justify-between">
          <span className="text-[9px] text-indigo-400 font-extrabold uppercase tracking-wider">Confidence</span>
          <span className="text-sm font-bold text-white">{decision.confidence}%</span>
        </div>
        <div className="bg-amber-950/20 border border-amber-500/20 rounded-lg p-2 flex flex-col justify-between">
          <span className="text-[9px] text-amber-400 font-extrabold uppercase tracking-wider">Tiebreaker</span>
          <span className="text-sm font-bold text-white">{decision.tiebroken ? 'Yes' : 'No'}</span>
        </div>
      </div>

      {/* Decision Routing Reason */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2.5">
        <span className="text-[9px] text-slate-500 font-extrabold uppercase tracking-wider block mb-1">Routing Recommendation</span>
        <p className="text-slate-300 leading-relaxed text-[11px] font-medium">{decision.routingReason}</p>
      </div>

      {/* Ranked / Eliminated Nodes */}
      <div className="space-y-2">
        <span className="text-[9px] text-slate-500 font-extrabold uppercase tracking-wider block">PC Node Rankings</span>
        <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
          {decision.rankedNodes.map((node, index) => {
            const isWinner = node.deviceId === decision.selectedDeviceId;
            return (
              <div
                key={node.deviceId}
                className={`p-2 rounded-lg border flex items-center justify-between gap-3 transition-all ${
                  isWinner
                    ? 'bg-cyan-500/10 border-cyan-500/30'
                    : 'bg-slate-900/40 border-slate-850 hover:bg-slate-900/60'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                    isWinner ? 'bg-cyan-500 text-black' : 'bg-slate-850 text-slate-400'
                  }`}>
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-200 truncate">{node.deviceName}</p>
                    <p className="text-[9px] text-slate-500 font-mono">CPU:{node.cpuUsage.toFixed(0)}% RAM:{node.ramUsage.toFixed(0)}% TEMP:{node.cpuTemp.toFixed(0)}°C</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className={`font-mono font-bold ${isWinner ? 'text-cyan-400' : 'text-slate-400'}`}>
                    {node.finalScore.toFixed(1)}
                  </span>
                </div>
              </div>
            );
          })}

          {decision.eliminatedNodes.map((node) => (
            <div
              key={node.deviceId}
              className="p-2 rounded-lg border bg-rose-950/10 border-rose-500/10 flex items-center justify-between gap-3 opacity-60"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] bg-rose-500/20 text-rose-400 font-bold">
                  ✖
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-rose-300 truncate">{node.deviceName}</p>
                  <p className="text-[9px] text-rose-500/80 truncate font-mono">Reason: {node.eliminationReason || 'Offline / Degradation'}</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0 font-mono text-rose-400">
                ELIM
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
