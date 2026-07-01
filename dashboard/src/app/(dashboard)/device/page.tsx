'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAppStore } from '@/store/appStore';
import { issueCommand, deleteDevice } from '@/lib/db';
import { dispatchCommandToDevice } from '@/lib/rtdb';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';
import {
  Monitor, Cpu, MemoryStick, Zap, HardDrive, Wifi, Thermometer,
  Terminal, Power, RefreshCw, Moon, Lock, Skull, Play, ChevronLeft,
  Activity, Loader2, Clock, ShieldCheck, Database, Server, Info
} from 'lucide-react';
import { format } from 'date-fns';

const MAX_HISTORY = 60;

interface MetricHistory {
  t: string;
  cpu: number;
  ram: number;
  gpu: number;
}

function DeviceDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id') || '';
  const router = useRouter();
  const { devices, metricsMap, processesMap, user } = useAppStore();

  const device = devices.find(d => d.deviceId === id);
  const metrics = id ? metricsMap[id] : null;
  const processes = id ? (processesMap[id] || []) : [];

  const [history, setHistory] = useState<MetricHistory[]>([]);
  const [cmdInput, setCmdInput] = useState('');
  const [cmdLoading, setCmdLoading] = useState(false);
  const [cmdResult, setCmdResult] = useState<string | null>(null);

  useEffect(() => {
    if (!metrics) return;
    const point: MetricHistory = {
      t: new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      cpu: Number(metrics.cpu.total.toFixed(1)),
      ram: Number(metrics.ram.usedPercent.toFixed(1)),
      gpu: Number(metrics.gpu.usagePercent.toFixed(1)),
    };
    setHistory(prev => [...prev.slice(-MAX_HISTORY + 1), point]);
  }, [metrics?.timestamp]);

  const handleCommand = async (type: string, payload: Record<string, unknown> = {}) => {
    if (!device || !user || !id) return;
    setCmdLoading(true);
    setCmdResult(null);
    try {
      const commandId = await issueCommand(id, device.name || device.machineName, type as any, payload, user.uid);
      await dispatchCommandToDevice(id, commandId, type, payload);
      setCmdResult(`Command "${type}" dispatched successfully`);
    } catch (err: unknown) {
      setCmdResult(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setCmdLoading(false);
    }
  };

  const online = metrics?.status === 'online';

  const handleRemoveDevice = async () => {
    if (!id) return;
    if (confirm("Are you sure you want to remove this device? This will unlink it from your account and stop monitoring.")) {
      try {
        await deleteDevice(id);
        router.push('/devices');
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Failed to remove device');
      }
    }
  };

  const getHealthBadgeColor = (status?: string) => {
    if (status === 'critical') return 'bg-red-500/10 text-red-400 border border-red-500/20';
    if (status === 'degraded') return 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
    return 'bg-green-500/10 text-green-400 border border-green-500/20';
  };

  const formatUptime = (seconds?: number) => {
    if (!seconds) return 'N/A';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hrs}h ${mins}m`;
  };

  if (!id) {
    return <div className="text-center py-20 text-slate-500">No device selected</div>;
  }

  if (!device) {
    return (
      <div className="text-center py-20 text-slate-500">
        <Monitor className="w-10 h-10 mx-auto mb-3 opacity-20" />
        <p>Device not found or loading...</p>
        <button onClick={() => router.push('/devices')} className="mt-3 text-green-400 text-sm hover:underline">
          ← Back to Devices
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/devices')} className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-all flex-shrink-0">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center flex-shrink-0">
            <Monitor className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white leading-tight">{device.name || device.machineName}</h1>
            <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap mt-0.5">
              <span className="font-mono text-slate-500">{device.deviceId}</span>
              <span>·</span>
              <div className={`flex items-center gap-1 ${online ? 'text-green-400' : 'text-slate-500'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
                {online ? 'Online' : 'Offline'}
              </div>
              {online && metrics?.healthStatus && (
                <>
                  <span>·</span>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold capitalize ${getHealthBadgeColor(metrics.healthStatus)}`}>
                    Health: {metrics.healthStatus}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        
        <button
          onClick={handleRemoveDevice}
          className="flex items-center justify-center gap-2 px-3.5 py-2 bg-red-500/10 hover:bg-red-500 hover:text-black text-red-400 border border-red-500/20 font-semibold rounded-lg text-sm transition-all sm:self-center"
        >
          <Skull className="w-4 h-4" />
          Remove Device
        </button>
      </div>

      {/* Hardware Configurations (CPU / GPU specs) */}
      {online && metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="glass-card p-4 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
              <Cpu className="w-5 h-5 text-blue-400" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Processor Config</span>
              <h3 className="text-sm font-semibold text-white truncate mt-0.5">{metrics?.cpu?.name || 'Intel/AMD Processor'}</h3>
              <p className="text-xs text-slate-400 mt-1">{metrics?.cpu?.cores?.length ?? '8'} Cores / Logical Processors</p>
            </div>
          </div>
          <div className="glass-card p-4 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
              <Zap className="w-5 h-5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Graphics Card Config</span>
              <h3 className="text-sm font-semibold text-white truncate mt-0.5">{metrics?.gpu?.name || 'Integrated/No Dedicated GPU'}</h3>
              <p className="text-xs text-slate-400 mt-1">{metrics?.gpu?.memTotal ? `${(metrics.gpu.memTotal / 1024).toFixed(1)} GB VRAM` : 'No dedicated VRAM reported'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Metric Cards Grid */}
      {online && metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'CPU Usage', value: metrics?.cpu?.total ?? 0, unit: '%', icon: Cpu, color: '#3b82f6' },
            { label: 'RAM Usage', value: metrics?.ram?.usedPercent ?? 0, unit: '%', icon: MemoryStick, color: '#8b5cf6' },
            { label: 'GPU Usage', value: metrics?.gpu?.usagePercent ?? 0, unit: '%', icon: Zap, color: '#f59e0b' },
            { label: 'Disk Space', value: metrics?.disk?.usedPercent ?? 0, unit: '%', icon: HardDrive, color: '#ec4899' },
            { label: 'CPU Temp', value: metrics?.temperatures?.cpu ?? 0, unit: '°C', icon: Thermometer, color: '#ef4444' },
            { label: 'Ping Latency', value: metrics?.network?.latencyMs ?? 0, unit: 'ms', icon: Wifi, color: '#22c55e' },
          ].map(m => (
            <div key={m.label} className="glass-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <m.icon className="w-3.5 h-3.5" style={{ color: m.color }} />
                <span className="text-[11px] text-slate-400 font-medium truncate">{m.label}</span>
              </div>
              <div className="text-xl font-bold text-white tabular-nums">
                {Number(m.value).toFixed(1)}<span className="text-xs text-slate-500 ml-0.5 font-normal">{m.unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detailed Diagnostics Section */}
      {online && metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Detailed RAM */}
          <div className="glass-card p-4 space-y-2">
            <h3 className="text-xs font-bold text-purple-400 uppercase tracking-wider flex items-center gap-2">
              <MemoryStick className="w-3.5 h-3.5" /> Memory Details
            </h3>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-slate-400">Total Installed:</span><span className="text-white font-mono">{Number(metrics?.ram?.total ?? 0).toFixed(1)} GB</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Used Memory:</span><span className="text-white font-mono">{Number(metrics?.ram?.used ?? 0).toFixed(1)} GB</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Available:</span><span className="text-white font-mono">{Number(metrics?.ram?.available ?? 0).toFixed(1)} GB</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Usage:</span><span className="text-white font-mono">{Number(metrics?.ram?.usedPercent ?? 0).toFixed(1)}%</span></div>
            </div>
          </div>

          {/* Detailed GPU Memory */}
          <div className="glass-card p-4 space-y-2">
            <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2">
              <Zap className="w-3.5 h-3.5" /> Video RAM (VRAM)
            </h3>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-slate-400">Dedicated VRAM:</span><span className="text-white font-mono">{metrics?.gpu?.memTotal ? `${(metrics.gpu.memTotal / 1024).toFixed(1)} GB` : 'N/A'}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Used VRAM:</span><span className="text-white font-mono">{metrics?.gpu?.memUsed ? `${metrics.gpu.memUsed.toFixed(0)} MB` : 'N/A'}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">VRAM Usage:</span><span className="text-white font-mono">{metrics?.gpu?.memUsedPercent ? `${metrics.gpu.memUsedPercent.toFixed(1)}%` : 'N/A'}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">GPU Temp:</span><span className="text-white font-mono">{metrics?.temperatures?.gpu ? `${metrics.temperatures.gpu.toFixed(0)}°C` : 'N/A'}</span></div>
            </div>
          </div>

          {/* Detailed Disk I/O */}
          <div className="glass-card p-4 space-y-2">
            <h3 className="text-xs font-bold text-pink-400 uppercase tracking-wider flex items-center gap-2">
              <HardDrive className="w-3.5 h-3.5" /> Disk Performance
            </h3>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-slate-400">Volume Drive:</span><span className="text-white font-mono">{metrics?.disk?.driveName || 'C:'}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Capacity Size:</span><span className="text-white font-mono">{Number(metrics?.disk?.total ?? 0).toFixed(0)} GB</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Read Speed:</span><span className="text-green-400 font-mono">{metrics?.disk?.readMbps ? `${metrics.disk.readMbps.toFixed(2)} MB/s` : '0.00 MB/s'}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Write Speed:</span><span className="text-blue-400 font-mono">{metrics?.disk?.writeMbps ? `${metrics.disk.writeMbps.toFixed(2)} MB/s` : '0.00 MB/s'}</span></div>
            </div>
          </div>

          {/* Detailed Net & Queue */}
          <div className="glass-card p-4 space-y-2">
            <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
              <Wifi className="w-3.5 h-3.5" /> Network & Queue
            </h3>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-slate-400">Download speed:</span><span className="text-white font-mono">{Number(metrics?.network?.downloadMbps ?? 0).toFixed(2)} Mbps</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Upload speed:</span><span className="text-white font-mono">{Number(metrics?.network?.uploadMbps ?? 0).toFixed(2)} Mbps</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Running Tasks:</span><span className="text-white font-mono">{metrics?.runningTasks ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">System Uptime:</span><span className="text-white font-mono">{formatUptime(metrics?.uptimeSeconds)}</span></div>
            </div>
          </div>
        </div>
      )}

      {/* Real-time chart */}
      <div className="glass-card p-5">
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-green-400" />
          Real-Time Metrics (5min window)
        </h2>
        {history.length < 2 ? (
          <div className="h-48 flex items-center justify-center text-slate-600 text-sm">
            {online ? 'Collecting data...' : 'Device is offline'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={history} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                {[{ id: 'cpu', color: '#3b82f6' }, { id: 'ram', color: '#8b5cf6' }, { id: 'gpu', color: '#f59e0b' }].map(({ id: gId, color }) => (
                  <linearGradient key={gId} id={`grad-${gId}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#64748b' }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} unit="%" />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }} labelStyle={{ color: '#94a3b8' }} />
              {[['cpu', '#3b82f6', 'CPU'], ['ram', '#8b5cf6', 'RAM'], ['gpu', '#f59e0b', 'GPU']].map(([key, color, name]) => (
                <Area key={key} type="monotone" dataKey={key} name={name} stroke={color} strokeWidth={1.5} fill={`url(#grad-${key})`} dot={false} isAnimationActive={false} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Processes + Commands */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-green-400" />
            Top Processes
          </h2>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {processes.length === 0 ? (
              <p className="text-slate-500 text-sm">No process data</p>
            ) : (
              processes.slice(0, 15).map(proc => (
                <div key={proc.pid} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-slate-800/40 group">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{proc.name}</div>
                    <div className="text-xs text-slate-500">PID {proc.pid}</div>
                  </div>
                  <div className="flex gap-3 text-xs font-mono text-slate-400 flex-shrink-0">
                    <span className="w-10 text-right">{proc.cpuPercent.toFixed(1)}%</span>
                    <span className="w-14 text-right">{proc.ramMB}MB</span>
                  </div>
                  <button onClick={() => handleCommand('kill_process', { pid: proc.pid })} className="opacity-0 group-hover:opacity-100 p-1.5 text-red-400 hover:bg-red-500/10 rounded transition-all flex-shrink-0" title="Kill process">
                    <Skull className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="glass-card p-5">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-green-400" />
            Remote Commands
          </h2>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {[
              { type: 'shutdown', icon: Power, label: 'Shutdown', color: 'text-red-400 hover:bg-red-500/10 border-red-500/20' },
              { type: 'restart', icon: RefreshCw, label: 'Restart', color: 'text-orange-400 hover:bg-orange-500/10 border-orange-500/20' },
              { type: 'sleep', icon: Moon, label: 'Sleep', color: 'text-blue-400 hover:bg-blue-500/10 border-blue-500/20' },
              { type: 'lock', icon: Lock, label: 'Lock', color: 'text-purple-400 hover:bg-purple-500/10 border-purple-500/20' },
            ].map(cmd => (
              <button key={cmd.type} onClick={() => handleCommand(cmd.type)} disabled={cmdLoading || !online} className={`flex items-center justify-center gap-2 px-3 py-2.5 border rounded-lg text-sm font-medium transition-all disabled:opacity-40 ${cmd.color}`}>
                <cmd.icon className="w-4 h-4" />
                {cmd.label}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input type="text" value={cmdInput} onChange={e => setCmdInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && cmdInput && handleCommand('run_cmd', { command: cmdInput })} placeholder="CMD command..." className="flex-1 px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 font-mono focus:outline-none focus:border-green-500/40" />
              <button onClick={() => cmdInput && handleCommand('run_cmd', { command: cmdInput })} disabled={cmdLoading || !cmdInput || !online} className="p-2 bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 rounded-lg transition-all disabled:opacity-40 flex-shrink-0">
                {cmdLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              </button>
            </div>
            {cmdResult && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-300">{cmdResult}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DeviceDetailPage() {
  return (
    <Suspense fallback={
      <div className="text-center py-20 text-slate-500">
        <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-green-400" />
        <p className="text-sm">Loading device...</p>
      </div>
    }>
      <DeviceDetailContent />
    </Suspense>
  );
}
