'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore, selectClusterStats } from '@/store/appStore';
import { createCluster, addDeviceToCluster, removeDeviceFromCluster, deleteCluster } from '@/lib/db';
import {
  Network, Plus, Monitor, Cpu, MemoryStick, Zap,
  Trash2, ChevronDown, ChevronUp, X, Loader2, CheckCircle, Play
} from 'lucide-react';

const CLUSTER_COLORS = [
  '#22c55e', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6', '#f97316'
];

export default function ClustersPage() {
  const { clusters, devices, metricsMap, user } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newColor, setNewColor] = useState(CLUSTER_COLORS[0]);
  const [creating, setCreating] = useState(false);
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newName || !user) return;
    setCreating(true);
    try {
      await createCluster(user.uid, newName, newDesc, newColor);
      setShowCreate(false);
      setNewName(''); setNewDesc('');
    } finally {
      setCreating(false);
    }
  };

  const handleAddDevice = async (clusterId: string, deviceId: string) => {
    await addDeviceToCluster(clusterId, deviceId);
  };

  const handleRemoveDevice = async (clusterId: string, deviceId: string) => {
    await removeDeviceFromCluster(clusterId, deviceId);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Clusters</h1>
          <p className="text-slate-400 text-sm mt-0.5">Logical groups of devices for coordinated management</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-400 text-black font-semibold rounded-lg text-sm transition-all"
        >
          <Plus className="w-4 h-4" />
          New Cluster
        </button>
      </div>

      {clusters.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <Network className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="font-medium">No clusters yet</p>
          <p className="text-sm mt-1">Create your first cluster to group devices together</p>
        </div>
      ) : (
        <div className="space-y-4">
          {clusters.map((cluster, i) => {
            const clusterDevices = devices.filter(d => (cluster.deviceIds ?? []).includes(d.deviceId));
            const onlineDevices = clusterDevices.filter(d => metricsMap[d.deviceId]?.status === 'online');
            const availableDevices = devices.filter(d => !(cluster.deviceIds ?? []).includes(d.deviceId));

            const avgCpu = onlineDevices.length > 0
              ? onlineDevices.reduce((acc, d) => acc + (metricsMap[d.deviceId]?.cpu.total || 0), 0) / onlineDevices.length
              : 0;
            const totalRam = onlineDevices.reduce((acc, d) => acc + (metricsMap[d.deviceId]?.ram.total || 0), 0);
            const usedRam = onlineDevices.reduce((acc, d) => acc + (metricsMap[d.deviceId]?.ram.used || 0), 0);
            const isExpanded = expandedCluster === cluster.id;

            return (
              <motion.div
                key={cluster.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-card overflow-hidden"
                style={{ borderColor: `${cluster.color}30` }}
              >
                {/* Cluster header */}
                <div
                  className="p-5 cursor-pointer flex items-center gap-4"
                  onClick={() => setExpandedCluster(isExpanded ? null : cluster.id)}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${cluster.color}15`, border: `1px solid ${cluster.color}30` }}
                  >
                    <Network className="w-5 h-5" style={{ color: cluster.color }} />
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-white">{cluster.name}</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                        {(cluster.deviceIds ?? []).length} devices
                      </span>
                      <span className="text-xs text-green-400">
                        {onlineDevices.length} online
                      </span>
                    </div>
                    {cluster.description && (
                      <p className="text-xs text-slate-500 mt-0.5">{cluster.description}</p>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="hidden sm:flex gap-6 text-center">
                    {[
                      { label: 'Avg CPU', value: `${avgCpu.toFixed(0)}%` },
                      { label: 'RAM Used', value: `${usedRam.toFixed(0)}/${totalRam.toFixed(0)} GB` },
                    ].map(stat => (
                      <div key={stat.label}>
                        <div className="text-sm font-bold text-white tabular-nums">{stat.value}</div>
                        <div className="text-xs text-slate-500">{stat.label}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        window.location.href = `/jobs/?clusterId=${cluster.id}`;
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/20 hover:bg-green-500/20 text-green-400 rounded-lg text-xs font-semibold transition-all"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Run Job
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); deleteCluster(cluster.id); }}
                      className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </div>
                </div>

                {/* Expanded device list */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="border-t border-slate-800 overflow-hidden"
                    >
                      <div className="p-4 space-y-3">
                        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Devices in Cluster</h4>

                        {clusterDevices.length === 0 ? (
                          <p className="text-slate-600 text-sm">No devices in this cluster</p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {clusterDevices.map(device => {
                              const m = metricsMap[device.deviceId];
                              const online = m?.status === 'online';
                              return (
                                <div key={device.id} className="flex items-center gap-3 p-3 bg-slate-900/40 rounded-lg">
                                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${online ? 'bg-green-400' : 'bg-slate-600'}`} />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm text-white truncate">{device.name || device.machineName}</div>
                                    {online && m && (
                                      <div className="text-xs text-slate-500 font-mono">
                                        CPU {m.cpu.total.toFixed(0)}% · RAM {m.ram.usedPercent.toFixed(0)}%
                                      </div>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => handleRemoveDevice(cluster.id, device.deviceId)}
                                    className="p-1 text-slate-600 hover:text-red-400 rounded"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Add device */}
                        {availableDevices.length > 0 && (
                          <div>
                            <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Add Device</h4>
                            <div className="flex flex-wrap gap-2">
                              {availableDevices.map(device => (
                                <button
                                  key={device.id}
                                  onClick={() => handleAddDevice(cluster.id, device.deviceId)}
                                  className="flex items-center gap-2 px-3 py-1.5 border border-slate-700 text-slate-300 hover:border-green-500/40 hover:text-green-400 rounded-lg text-xs transition-all"
                                >
                                  <Plus className="w-3 h-3" />
                                  {device.name || device.machineName}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Create Cluster Dialog */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setShowCreate(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-card p-6 w-full max-w-md border border-slate-700"
            >
              <h2 className="font-semibold text-white mb-4">Create New Cluster</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Cluster Name *</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="e.g. AI LAB, RENDER FARM"
                    className="w-full px-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500/40"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Description</label>
                  <input
                    type="text"
                    value={newDesc}
                    onChange={e => setNewDesc(e.target.value)}
                    placeholder="Optional description"
                    className="w-full px-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500/40"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Color</label>
                  <div className="flex gap-2">
                    {CLUSTER_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setNewColor(c)}
                        className={`w-7 h-7 rounded-full transition-all ${newColor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : ''}`}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowCreate(false)}
                    className="flex-1 py-2.5 border border-slate-700 text-slate-400 hover:text-white rounded-lg text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!newName || creating}
                    className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-semibold rounded-lg text-sm flex items-center justify-center gap-2"
                  >
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Network className="w-4 h-4" />}
                    Create Cluster
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
