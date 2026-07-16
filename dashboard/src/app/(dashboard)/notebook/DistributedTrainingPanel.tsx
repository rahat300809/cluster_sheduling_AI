'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Monitor, Play, Loader2, CheckCircle,
  XCircle, Clock, AlertTriangle, Download, ChevronDown, ChevronUp,
  Layers, GitBranch, Sparkles, Info
} from 'lucide-react';
import type {
  Device, SystemSnapshot, DistributedTrainingSession,
  DistributedNodeStatus
} from '@/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ─── Node Status Card ─────────────────────────────────────────────────────────

function NodeCard({
  node,
  metrics,
  isExpanded,
  onToggle,
}: {
  node: DistributedNodeStatus;
  metrics?: SystemSnapshot;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const handleDownloadArtifact = (art: any) => {
    if (art.base64) {
      try {
        const binStr = atob(art.base64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }
        const ext = art.name.split('.').pop()?.toLowerCase() || '';
        let mimeType = 'application/octet-stream';
        if (ext === 'json') mimeType = 'application/json';
        else if (ext === 'csv') mimeType = 'text/csv';
        else if (ext === 'txt' || ext === 'log') mimeType = 'text/plain';
        const blob = new Blob([bytes], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = art.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Failed to decode base64 artifact:', err);
        alert('Failed to download artifact: Data corruption.');
      }
    } else {
      window.open(art.downloadUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const statusConfig = {
    pending:   { color: '#94a3b8', bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.06)', Icon: Clock, label: 'Pending' },
    running:   { color: '#a78bfa', bg: 'rgba(139,92,246,0.08)',  border: 'rgba(139,92,246,0.20)',  Icon: Loader2, label: 'Running' },
    completed: { color: '#34d399', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.20)', Icon: CheckCircle, label: 'Completed' },
    failed:    { color: '#f43f5e', bg: 'rgba(244,63,94,0.08)',   border: 'rgba(244,63,94,0.20)',   Icon: XCircle, label: 'Failed' },
  }[node.status];

  const { color, bg, border, Icon, label } = statusConfig;
  const gpuMem = metrics?.gpu.memTotal ? `${(metrics.gpu.memTotal / 1024).toFixed(1)} GB VRAM` : null;

  return (
    <motion.div
      layout
      className="distributed-node-card overflow-hidden"
      style={{ borderColor: node.status === 'running' ? 'rgba(167,139,250,0.35)' : undefined }}
    >
      {/* Header row */}
      <div
        className="flex items-center gap-3 p-3.5 cursor-pointer select-none"
        onClick={onToggle}
      >
        {/* Shard badge */}
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-xs font-bold text-white animate-pulse-glow"
          style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: '0 2px 8px rgba(99,102,241,0.30)' }}
        >
          #{node.shardIndex}
        </div>

        {/* Device name */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate text-bright">
            {node.deviceName}
          </div>
          <div className="text-[10px] font-medium flex items-center gap-1.5 mt-0.5 text-muted">
            <span>Shard {node.shardIndex + 1}</span>
            {gpuMem && <><span>·</span><span style={{ color: '#fcd34d' }}>{gpuMem}</span></>}
            {metrics?.gpu.name && <><span>·</span><span className="truncate text-muted">{metrics.gpu.name}</span></>}
          </div>
        </div>

        {/* Status badge */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0"
          style={{ background: bg, border: `1px solid ${border}`, color }}
        >
          <Icon
            className="w-3.5 h-3.5"
            style={{ animation: node.status === 'running' ? 'spin 1s linear infinite' : 'none' }}
          />
          {label}
        </div>

        {/* Chevron */}
        {isExpanded ? <ChevronUp className="w-4 h-4 flex-shrink-0 text-muted" /> : <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted" />}
      </div>

      {/* Progress bar */}
      {(node.status === 'running' || node.status === 'completed') && (
        <div className="px-3.5 pb-3">
          <div className="node-progress-bar">
            <div
              className="node-progress-fill"
              style={{
                width: `${node.status === 'completed' ? 100 : node.progress >= 0 ? node.progress : 30}%`,
                animationPlayState: node.status === 'completed' ? 'paused' : 'running',
                background: node.status === 'completed'
                  ? 'linear-gradient(90deg, #10b981, #059669)'
                  : undefined,
              }}
            />
          </div>
          {node.progress >= 0 && (
            <div className="text-[10px] font-semibold mt-1 text-muted">
              {node.status === 'completed' ? '100%' : `${node.progress}%`} complete
            </div>
          )}
        </div>
      )}

      {/* Expanded details */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="border-t border-slate-900/60"
          >
            <div className="p-4 bg-slate-950/40 space-y-3">
              {/* Output log */}
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: 10,
                  padding: 10,
                  borderRadius: 6,
                  background: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  color: '#cbd5e1',
                  maxHeight: 120,
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {node.lastLine || (node.status === 'pending' ? 'Waiting to start…' : 'No output yet')}
              </div>

              {/* Artifacts */}
              {node.artifacts && node.artifacts.length > 0 && (
                <div className="space-y-1">
                  {node.artifacts.map((art, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleDownloadArtifact(art)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all w-full text-left cursor-pointer"
                      style={{
                        background: 'rgba(16,185,129,0.06)',
                        border: '1px solid rgba(16,185,129,0.18)',
                        color: '#34d399',
                      }}
                    >
                      <Download className="w-3.5 h-3.5 flex-shrink-0 text-emerald-400" />
                      <span className="truncate">{art.name}</span>
                      <span className="ml-auto flex-shrink-0 text-[10px] text-muted">
                        {formatBytes(art.size)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Device Selector ──────────────────────────────────────────────────────────

function DeviceSelector({
  devices,
  metricsMap,
  selectedIds,
  onToggle,
}: {
  devices: Device[];
  metricsMap: Record<string, SystemSnapshot>;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const onlineGpuDevices = devices.filter(d => {
    const m = metricsMap[d.deviceId];
    return m?.status === 'online';
  });

  if (onlineGpuDevices.length === 0) {
    return (
      <div
        className="flex items-center gap-3 p-4 rounded-xl glass-rose"
      >
        <AlertTriangle className="w-5 h-5 flex-shrink-0 text-rose-400" />
        <div>
          <div className="text-sm font-semibold text-bright">No online devices</div>
          <div className="text-xs mt-0.5 text-muted">Connect devices to enable distributed training</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {onlineGpuDevices.map(device => {
        const m = metricsMap[device.deviceId];
        const isSelected = selectedIds.includes(device.deviceId);
        const hasGpu = (m?.gpu.memTotal || 0) > 0;
        const gpuLoad = m?.gpu.usagePercent || 0;
        const gpuMem = m?.gpu.memTotal ? (m.gpu.memTotal / 1024).toFixed(1) : null;

        return (
          <motion.div
            key={device.deviceId}
            className={`distributed-node-card ${isSelected ? 'selected' : ''} cursor-pointer`}
            onClick={() => onToggle(device.deviceId)}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
          >
            <div className="flex items-center gap-3 p-3">
              {/* Checkbox */}
              <div
                className="w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0 transition-all"
                style={isSelected ? {
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  boxShadow: '0 2px 8px rgba(99,102,241,0.30)',
                } : {
                  background: 'rgba(255,255,255,0.03)',
                  border: '2px solid rgba(255,255,255,0.08)',
                }}
              >
                {isSelected && (
                  <CheckCircle className="w-3.5 h-3.5 text-white animate-online" />
                )}
              </div>

              {/* Device icon */}
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: hasGpu ? 'rgba(245,158,11,0.08)' : 'rgba(99,102,241,0.06)', border: `1px solid ${hasGpu ? 'rgba(245,158,11,0.18)' : 'rgba(99,102,241,0.12)'}` }}
              >
                <Monitor className="w-4 h-4" style={{ color: hasGpu ? '#fcd34d' : '#818cf8' }} />
              </div>

              {/* Device info */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate text-bright">
                  {device.name || device.machineName}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] font-semibold">
                  <span style={{ color: '#818cf8' }}>CPU {(m?.cpu.total || 0).toFixed(0)}%</span>
                  <span className="text-muted">·</span>
                  <span style={{ color: '#c084fc' }}>RAM {(m?.ram.usedPercent || 0).toFixed(0)}%</span>
                  {hasGpu && (
                    <>
                      <span className="text-muted">·</span>
                      <span style={{ color: '#fcd34d' }}>{m?.gpu.name?.split(' ').slice(-2).join(' ')}</span>
                      <span className="text-muted">·</span>
                      <span style={{ color: '#fb923c' }}>{gpuMem} GB VRAM</span>
                    </>
                  )}
                  {!hasGpu && <span className="text-muted">(No GPU — CPU training)</span>}
                </div>
              </div>

              {/* GPU load indicator */}
              {hasGpu && (
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <div className="text-[10px] font-bold" style={{ color: gpuLoad > 60 ? '#f43f5e' : '#fcd34d' }}>
                    {gpuLoad.toFixed(0)}% GPU
                  </div>
                  <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${gpuLoad}%`,
                        background: gpuLoad > 80 ? '#f43f5e' : gpuLoad > 60 ? '#fb923c' : '#34d399',
                        transition: 'width 0.5s ease',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ─── Main Distributed Training Panel ─────────────────────────────────────────

interface DistributedTrainingPanelProps {
  devices: Device[];
  metricsMap: Record<string, SystemSnapshot>;
  onLaunch: (selectedDeviceIds: string[]) => Promise<void>;
  session: DistributedTrainingSession | null;
  isLaunching: boolean;
  notebookName: string;
}

export function DistributedTrainingPanel({
  devices,
  metricsMap,
  onLaunch,
  session,
  isLaunching,
}: DistributedTrainingPanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // Auto-select all online GPU devices on first render
  useEffect(() => {
    const gpuDevices = devices.filter(d => {
      const m = metricsMap[d.deviceId];
      return m?.status === 'online' && (m.gpu.memTotal || 0) > 0;
    });
    if (gpuDevices.length > 0 && selectedIds.length === 0) {
      setSelectedIds(gpuDevices.map(d => d.deviceId));
    }
  }, [devices, metricsMap]);

  const toggleDevice = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleNode = (id: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalVram = selectedIds.reduce((acc, id) => {
    const m = metricsMap[id];
    return acc + (m?.gpu.memTotal || 0);
  }, 0);

  const canLaunch = selectedIds.length >= 1 && !isLaunching && session?.status !== 'running';

  // Session summary stats
  const sessionCompleted = session?.nodeStatuses.filter(n => n.status === 'completed').length || 0;
  const sessionFailed = session?.nodeStatuses.filter(n => n.status === 'failed').length || 0;
  const sessionRunning = session?.nodeStatuses.filter(n => n.status === 'running').length || 0;

  return (
    <div className="space-y-5">

      {/* ─── Header Banner ─────────────────────────────────────────── */}
      <div
        className="p-4 rounded-2xl relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.06) 50%, rgba(6,182,212,0.04) 100%)',
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.40)',
        }}
      >
        {/* Decorative glow */}
        <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full opacity-10 pointer-events-none"
          style={{ background: 'radial-gradient(circle, #8b5cf6 0%, transparent 70%)' }} />

        <div className="flex items-start gap-3 relative z-10">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 animate-pulse-glow"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: '0 4px 16px rgba(99,102,241,0.40)' }}
          >
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-bright">Distributed Multi-GPU Training</h3>
            <p className="text-xs mt-1 leading-relaxed text-muted">
              Train your model across multiple PCs simultaneously using <strong className="text-glow-violet text-[#a78bfa]">data parallelism</strong>.
              Each device gets an equal shard of the dataset and trains independently — reducing training time proportionally.
            </p>
          </div>
        </div>

        {/* Stats row */}
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-4 mt-3 pt-3 relative z-10" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            {[
              { label: 'Nodes', value: selectedIds.length, color: '#818cf8' },
              { label: 'Total VRAM', value: totalVram > 0 ? `${(totalVram / 1024).toFixed(1)} GB` : 'N/A', color: '#fb923c' },
              { label: 'Speedup Est.', value: `~${selectedIds.length}×`, color: '#34d399' },
            ].map(stat => (
              <div key={stat.label} className="flex flex-col items-center">
                <span className="text-base font-bold" style={{ color: stat.color }}>{stat.value}</span>
                <span className="text-[10px] font-semibold text-muted">{stat.label}</span>
              </div>
            ))}
            <div className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg glass-amber">
              <Info className="w-3.5 h-3.5 text-amber-400" />
              Data Parallel
            </div>
          </div>
        )}
      </div>

      {/* ─── Active Session Monitor ────────────────────────────────── */}
      <AnimatePresence>
        {session && (session.status === 'running' || session.status === 'completed' || session.status === 'failed' || session.status === 'partial') && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-3"
          >
            {/* Session status bar */}
            <div
              className={`flex items-center justify-between p-3.5 rounded-xl ${
                session.status === 'completed' ? 'glass-emerald' :
                session.status === 'failed' ? 'glass-rose' : 'glass-violet'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {session.status === 'running' && <Loader2 className="w-4 h-4 animate-spin text-purple-400" />}
                {session.status === 'completed' && <CheckCircle className="w-4 h-4 text-emerald-400" />}
                {(session.status === 'failed' || session.status === 'partial') && <XCircle className="w-4 h-4 text-rose-400" />}
                <div>
                  <div className="text-sm font-bold text-bright">
                    Distributed Training Session
                  </div>
                  <div className="text-[10px] font-medium text-muted">
                    {sessionRunning > 0 && `${sessionRunning} running · `}
                    {sessionCompleted} / {session.totalShards} nodes completed
                    {sessionFailed > 0 && ` · ${sessionFailed} failed`}
                  </div>
                </div>
              </div>
              <div
                className="text-[10px] font-bold px-2.5 py-1 rounded-full capitalize"
                style={{
                  background: session.status === 'completed' ? 'rgba(16,185,129,0.12)' :
                               session.status === 'failed' ? 'rgba(244,63,94,0.12)' :
                               'rgba(139,92,246,0.12)',
                  color: session.status === 'completed' ? '#34d399' :
                         session.status === 'failed' ? '#f43f5e' :
                         '#c084fc',
                  border: `1px solid ${session.status === 'completed' ? 'rgba(16,185,129,0.22)' :
                                        session.status === 'failed' ? 'rgba(244,63,94,0.22)' :
                                        'rgba(139,92,246,0.22)'}`,
                }}
              >
                {session.status}
              </div>
            </div>

            {/* Per-node cards */}
            <div className="space-y-2">
              {session.nodeStatuses.map(node => (
                <NodeCard
                  key={node.deviceId}
                  node={node}
                  metrics={metricsMap[node.deviceId]}
                  isExpanded={expandedNodes.has(node.deviceId)}
                  onToggle={() => toggleNode(node.deviceId)}
                />
              ))}
            </div>

            {/* ─── Client-side Model Aggregation (Consensus/Averaging) ─── */}
            {(() => {
              if (session.status !== 'completed') return null;

              // Find any JSON artifacts
              const jsonArtifacts: { shardIndex: number; name: string; base64?: string; downloadUrl: string }[] = [];
              const pytorchArtifacts: string[] = [];

              session.nodeStatuses.forEach(node => {
                if (node.artifacts && node.artifacts.length > 0) {
                  node.artifacts.forEach(art => {
                    const ext = art.name.split('.').pop()?.toLowerCase();
                    if (ext === 'json') {
                      jsonArtifacts.push({
                        shardIndex: node.shardIndex,
                        name: art.name,
                        base64: (art as any).base64,
                        downloadUrl: art.downloadUrl
                      });
                    } else if (ext === 'pt' || ext === 'pth') {
                      pytorchArtifacts.push(art.name);
                    }
                  });
                }
              });

              // Case A: We have JSON models that we can aggregate client-side (e.g. Linear Regression coefficients)
              if (jsonArtifacts.length >= 2) {
                try {
                  const parsedModels = jsonArtifacts.map(item => {
                    if (item.base64) {
                      const binStr = atob(item.base64);
                      return { shardIndex: item.shardIndex, name: item.name, data: JSON.parse(binStr) };
                    }
                    return null;
                  }).filter((x): x is { shardIndex: number; name: string; data: any } => x !== null && x.data && x.data.coefficients);

                  if (parsedModels.length >= 2) {
                    const sample = parsedModels[0].data;
                    const keys = Object.keys(sample.coefficients);
                    const metricKeys = sample.metrics ? Object.keys(sample.metrics) : [];

                    const sumCoefficients: Record<string, number> = {};
                    const sumMetrics: Record<string, number> = {};

                    keys.forEach(k => { sumCoefficients[k] = 0; });
                    metricKeys.forEach(k => { sumMetrics[k] = 0; });

                    parsedModels.forEach(m => {
                      keys.forEach(k => {
                        sumCoefficients[k] += (m.data.coefficients[k] ?? 0);
                      });
                      metricKeys.forEach(k => {
                        sumMetrics[k] += (m.data.metrics[k] ?? 0);
                      });
                    });

                    const count = parsedModels.length;
                    const avgCoefficients: Record<string, number> = {};
                    const avgMetrics: Record<string, number> = {};

                    keys.forEach(k => {
                      avgCoefficients[k] = Number((sumCoefficients[k] / count).toFixed(5));
                    });
                    metricKeys.forEach(k => {
                      avgMetrics[k] = Number((sumMetrics[k] / count).toFixed(6));
                    });

                    const aggregatedModel = {
                      model_type: (sample.model_type || 'LinearRegression') + "_Aggregated",
                      sessionId: session.id,
                      notebookName: session.notebookName,
                      total_shards_combined: count,
                      aggregatedAt: Date.now(),
                      coefficients: avgCoefficients,
                      metrics: avgMetrics
                    };

                    const handleDownloadAggregated = () => {
                      const str = JSON.stringify(aggregatedModel, null, 2);
                      const blob = new Blob([str], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `aggregated_${session.notebookName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_model.json`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    };

                    return (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="p-4 rounded-xl border flex flex-col gap-3 relative overflow-hidden"
                        style={{
                          background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(99,102,241,0.06) 100%)',
                          borderColor: 'rgba(16,185,129,0.25)',
                          boxShadow: '0 4px 16px rgba(16,185,129,0.05)'
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <Sparkles className="w-4 h-4 text-emerald-400" />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-bright">✨ Client-side Model Aggregation Complete</h4>
                            <p className="text-[10px] text-muted mt-0.5 leading-relaxed">
                              Successfully averaged model coefficients across <strong className="text-emerald-400">{count} shard models</strong> into a single consolidated model.
                            </p>
                          </div>
                        </div>

                        {/* Coeff view */}
                        <div className="bg-slate-950/60 rounded-lg p-2.5 font-mono text-[9px] border border-slate-900/60 text-slate-300 max-h-24 overflow-y-auto">
                          <div className="text-[8px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Averaged Coefficients:</div>
                          {Object.entries(avgCoefficients).map(([k, v]) => (
                            <div key={k} className="flex justify-between">
                              <span className="text-slate-400">{k}:</span>
                              <span className="font-bold text-emerald-400">{v}</span>
                            </div>
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={handleDownloadAggregated}
                          className="w-full py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 hover:opacity-90 active:scale-95 transition-all border-none cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download Consolidated Model
                        </button>
                      </motion.div>
                    );
                  }
                } catch (e) {
                  console.warn("Failed model aggregation calculation:", e);
                }
              }

              // Case B: We have PyTorch weights (.pt) files - show python FedAvg script instructions
              if (pytorchArtifacts.length >= 2) {
                return (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="p-3.5 rounded-xl border border-indigo-500/20 bg-indigo-500/5 flex flex-col gap-2"
                  >
                    <div className="flex items-start gap-2.5">
                      <Layers className="w-4 h-4 text-indigo-400 mt-0.5" />
                      <div>
                        <h4 className="text-xs font-bold text-bright">Distributed PyTorch Models Ready</h4>
                        <p className="text-[10px] text-muted mt-0.5 leading-relaxed">
                          PyTorch models must be aggregated using <strong className="text-indigo-300">Federated Averaging (FedAvg)</strong> inside Python to preserve tensor layouts.
                        </p>
                      </div>
                    </div>
                    <div className="bg-slate-950/80 rounded-lg p-2 font-mono text-[9px] border border-slate-900 text-indigo-400 overflow-x-auto">
                      <div className="text-slate-500"># Average PyTorch State Dicts:</div>
                      <div>import torch</div>
                      <div>s0 = torch.load("pytorch_model_shard_0.pt")</div>
                      <div>s1 = torch.load("pytorch_model_shard_1.pt")</div>
                      <div>avg = {'{'}k: (s0[k] + s1[k]) / 2 for k in s0.keys(){'}'}</div>
                      <div>torch.save(avg, "global_model.pt")</div>
                    </div>
                  </motion.div>
                );
              }

              return null;
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Device Selector ──────────────────────────────────────── */}
      {(!session || session.status === 'completed' || session.status === 'failed') && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-bold text-bright">
              Select GPU Nodes
            </h4>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedIds(devices.filter(d => metricsMap[d.deviceId]?.status === 'online').map(d => d.deviceId))}
                className="text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-all btn-glass"
              >
                Select All
              </button>
              <button
                onClick={() => setSelectedIds([])}
                className="text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-all btn-glass"
              >
                Clear
              </button>
            </div>
          </div>

          <DeviceSelector
            devices={devices}
            metricsMap={metricsMap}
            selectedIds={selectedIds}
            onToggle={toggleDevice}
          />
        </div>
      )}

      {/* ─── How It Works Info Box ────────────────────────────────── */}
      {selectedIds.length >= 2 && !session && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="p-3.5 rounded-xl glass-violet"
        >
          <div className="flex items-start gap-2">
            <GitBranch className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-indigo-400" />
            <div className="text-[11px] leading-relaxed text-muted">
              <strong className="text-bright">How data parallelism works:</strong> Your dataset will be split into{' '}
              <strong className="text-[#a78bfa]">{selectedIds.length} equal shards</strong>.
              Each PC receives its own shard and the same training script, running in parallel.
              The environment variable <code className="px-1 py-0.5 rounded font-mono text-[10px]" style={{ background: 'rgba(0,0,0,0.25)', color: '#38bdf8' }}>SHARD_INDEX</code> (0–{selectedIds.length - 1}) and{' '}
              <code className="px-1 py-0.5 rounded font-mono text-[10px]" style={{ background: 'rgba(0,0,0,0.25)', color: '#38bdf8' }}>TOTAL_SHARDS</code> ({selectedIds.length}) are auto-injected into your script.
            </div>
          </div>
        </motion.div>
      )}

      {/* ─── Launch Button ────────────────────────────────────────── */}
      {(!session || session.status === 'completed' || session.status === 'failed' || session.status === 'partial') && (
        <motion.button
          onClick={() => onLaunch(selectedIds)}
          disabled={!canLaunch}
          className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all relative overflow-hidden"
          style={canLaunch ? {
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #06b6d4 100%)',
            boxShadow: '0 6px 24px rgba(99,102,241,0.40)',
            color: 'white',
            cursor: 'pointer',
            border: 'none',
          } : {
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.05)',
            color: '#475569',
            cursor: 'not-allowed',
          }}
          whileHover={canLaunch ? { scale: 1.01 } : {}}
          whileTap={canLaunch ? { scale: 0.99 } : {}}
        >
          {/* Shimmer effect */}
          {canLaunch && (
            <div className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-500"
              style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)' }} />
          )}

          {isLaunching ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Launching {selectedIds.length} nodes…
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              {session?.status === 'completed' || session?.status === 'failed'
                ? `Re-run on ${selectedIds.length} GPU node${selectedIds.length !== 1 ? 's' : ''}`
                : `Launch Distributed Training · ${selectedIds.length} node${selectedIds.length !== 1 ? 's' : ''}`}
            </>
          )}
        </motion.button>
      )}
    </div>
  );
}
