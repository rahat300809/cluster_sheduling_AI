'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/store/appStore';
import { issueCommand } from '@/lib/db';
import { dispatchCommandToDevice } from '@/lib/rtdb';
import { Activity, Search, Skull, AlertCircle, Loader2, RefreshCw } from 'lucide-react';

export default function ProcessesPage() {
  const { devices, metricsMap, processesMap, user } = useAppStore();
  const [search, setSearch] = useState('');
  const [killingPid, setKillingPid] = useState<string | null>(null);

  // Combine all processes from all online devices
  const allProcesses = devices
    .filter(d => metricsMap[d.deviceId]?.status === 'online')
    .flatMap(device => {
      const procs = processesMap[device.deviceId] || [];
      return procs.map(p => ({
        ...p,
        deviceId: device.deviceId,
        deviceName: device.name || device.machineName,
      }));
    })
    .filter(p =>
      !search || p.name.toLowerCase().includes(search.toLowerCase()) || String(p.pid).includes(search)
    )
    .sort((a, b) => b.cpuPercent - a.cpuPercent);

  const handleKill = async (deviceId: string, pid: number, processName: string) => {
    if (!user) return;
    const key = `${deviceId}-${pid}`;
    setKillingPid(key);

    try {
      const device = devices.find(d => d.deviceId === deviceId);
      const commandId = await issueCommand(
        deviceId,
        device?.name || device?.machineName || deviceId,
        'kill_process',
        { pid },
        user.uid
      );
      await dispatchCommandToDevice(deviceId, commandId, 'kill_process', { pid });
    } catch (err) {
      console.error('Failed to kill process:', err);
    } finally {
      setTimeout(() => setKillingPid(null), 1500);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Processes</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {allProcesses.length} processes across {devices.filter(d => metricsMap[d.deviceId]?.status === 'online').length} online devices
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter by name or PID..."
          className="w-full pl-9 pr-4 py-2 bg-slate-900/60 border border-slate-800 rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-green-500/40"
        />
      </div>

      {/* Process table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                {['Process', 'PID', 'Device', 'CPU %', 'RAM (MB)', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allProcesses.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    <Activity className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    <p className="text-sm">
                      {devices.filter(d => metricsMap[d.deviceId]?.status === 'online').length === 0
                        ? 'No online devices'
                        : 'No processes match your search'}
                    </p>
                  </td>
                </tr>
              ) : (
                allProcesses.map((proc, i) => {
                  const key = `${proc.deviceId}-${proc.pid}`;
                  const killing = killingPid === key;

                  return (
                    <motion.tr
                      key={key}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(i * 0.02, 0.5) }}
                      className="border-b border-slate-800/40 hover:bg-slate-800/20 group"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0">
                            <Activity className="w-3.5 h-3.5 text-slate-500" />
                          </div>
                          <span className="text-sm text-white font-medium">{proc.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-slate-400">{proc.pid}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-1 bg-slate-800 text-slate-300 rounded-md">
                          {proc.deviceName}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(100, proc.cpuPercent * 5)}%`,
                                background: proc.cpuPercent > 20 ? '#ef4444' : proc.cpuPercent > 10 ? '#f59e0b' : '#3b82f6'
                              }}
                            />
                          </div>
                          <span className="text-sm font-mono text-slate-300 tabular-nums">
                            {proc.cpuPercent.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-slate-300 tabular-nums">
                        {proc.ramMB.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          proc.status === 'running'
                            ? 'bg-green-500/10 text-green-400'
                            : 'bg-amber-500/10 text-amber-400'
                        }`}>
                          {proc.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleKill(proc.deviceId, proc.pid, proc.name)}
                          disabled={killing}
                          className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-400 border border-red-500/20 hover:bg-red-500/10 rounded-lg transition-all disabled:opacity-50"
                        >
                          {killing ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Skull className="w-3 h-3" />
                          )}
                          Kill
                        </button>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
