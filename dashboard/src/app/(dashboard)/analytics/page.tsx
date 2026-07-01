'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/store/appStore';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, BarChart, Bar, Legend, LineChart, Line
} from 'recharts';
import { BarChart3, Cpu, MemoryStick, Zap, Activity, TrendingUp } from 'lucide-react';

export default function AnalyticsPage() {
  const { devices, metricsMap, jobs, commands } = useAppStore();

  const onlineDevices = devices.filter(d => metricsMap[d.deviceId]?.status === 'online');

  // Current device load comparison
  const deviceLoadData = onlineDevices.map(d => {
    const m = metricsMap[d.deviceId];
    return {
      name: (d.name || d.machineName || d.deviceId).slice(0, 12),
      cpu: m?.cpu?.total !== undefined ? Number(m.cpu.total.toFixed(1)) : 0,
      ram: m?.ram?.usedPercent !== undefined ? Number(m.ram.usedPercent.toFixed(1)) : 0,
      gpu: m?.gpu?.usagePercent !== undefined ? Number(m.gpu.usagePercent.toFixed(1)) : 0,
    };
  });

  // Job status distribution
  const jobStats = [
    { name: 'Completed', value: jobs.filter(j => j.status === 'completed').length, color: '#22c55e' },
    { name: 'Running', value: jobs.filter(j => j.status === 'running').length, color: '#3b82f6' },
    { name: 'Queued', value: jobs.filter(j => j.status === 'queued').length, color: '#f59e0b' },
    { name: 'Failed', value: jobs.filter(j => j.status === 'failed').length, color: '#ef4444' },
  ];

  // Command success rate
  const cmdSuccess = commands.filter(c => c.status === 'success').length;
  const cmdFailed = commands.filter(c => c.status === 'failed').length;
  const cmdSuccessRate = commands.length > 0 ? (cmdSuccess / commands.length * 100).toFixed(1) : 0;

  // Simulated temperature trend (real app would store historical data)
  const tempTrend = onlineDevices.slice(0, 5).map(d => ({
    name: (d.name || d.deviceId).slice(0, 10),
    cpu: metricsMap[d.deviceId]?.temperatures?.cpu?.toFixed(1) || 0,
    gpu: metricsMap[d.deviceId]?.temperatures?.gpu?.toFixed(1) || 0,
  }));

  const CustomTooltipStyle = {
    contentStyle: {
      background: '#0f172a',
      border: '1px solid #334155',
      borderRadius: '8px',
      fontSize: '12px',
      color: '#f8fafc'
    },
    labelStyle: { color: '#94a3b8' }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Analytics</h1>
        <p className="text-slate-400 text-sm mt-0.5">Performance insights across your cluster</p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Commands', value: commands.length, icon: Activity, color: 'text-blue-400' },
          { label: 'Success Rate', value: `${cmdSuccessRate}%`, icon: TrendingUp, color: 'text-green-400' },
          { label: 'Total Jobs', value: jobs.length, icon: BarChart3, color: 'text-purple-400' },
          { label: 'Online Devices', value: onlineDevices.length, icon: Cpu, color: 'text-orange-400' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card p-4"
          >
            <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
            <div className="text-2xl font-bold text-white tabular-nums">{stat.value}</div>
            <div className="text-xs text-slate-400 mt-1">{stat.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Device Load Comparison */}
      <div className="glass-card p-5">
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-green-400" />
          Device Load Comparison (Current)
        </h2>
        {deviceLoadData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
            No online devices to display
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={deviceLoadData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} unit="%" />
              <Tooltip {...CustomTooltipStyle} />
              <Legend
                wrapperStyle={{ fontSize: '12px', color: '#94a3b8', paddingTop: '8px' }}
              />
              <Bar dataKey="cpu" name="CPU %" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              <Bar dataKey="ram" name="RAM %" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
              <Bar dataKey="gpu" name="GPU %" fill="#f59e0b" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Job stats */}
        <div className="glass-card p-5">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-green-400" />
            Job Distribution
          </h2>
          <div className="space-y-3">
            {jobStats.map(stat => (
              <div key={stat.name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-400">{stat.name}</span>
                  <span className="text-xs font-mono text-slate-300">{stat.value}</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: jobs.length > 0 ? `${(stat.value / jobs.length) * 100}%` : '0%',
                      background: stat.color
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Temperature */}
        <div className="glass-card p-5">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-green-400" />
            Device Temperatures (°C)
          </h2>
          {tempTrend.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No temperature data</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={tempTrend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} unit="°" />
                <Tooltip {...CustomTooltipStyle} />
                <Legend wrapperStyle={{ fontSize: '12px', color: '#94a3b8', paddingTop: '8px' }} />
                <Bar dataKey="cpu" name="CPU °C" fill="#ef4444" radius={[3, 3, 0, 0]} />
                <Bar dataKey="gpu" name="GPU °C" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
