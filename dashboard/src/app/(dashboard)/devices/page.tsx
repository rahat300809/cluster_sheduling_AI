'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useAppStore } from '@/store/appStore';
import { pairDevice, deleteDevice, addHostBalance } from '@/lib/db';
import { consumePairCode, stopActiveRentalSessionRTDB } from '@/lib/rtdb';
import { db } from '@/lib/firebase';
import { doc, updateDoc, getDocs, collection, query, where } from 'firebase/firestore';
import {
  Monitor, Plus, Search, Wifi, WifiOff, Cpu, MemoryStick,
  Thermometer, Zap, MoreVertical, Trash2, Edit2, Link2, Loader2, Smartphone
} from 'lucide-react';

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05 } }),
};

export default function DevicesPage() {
  const { devices, metricsMap, user } = useAppStore();
  const [search, setSearch] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [pairLoading, setPairLoading] = useState(false);
  const [pairError, setPairError] = useState('');
  const [pairSuccess, setPairSuccess] = useState(false);
  const [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (deviceDocId: string, deviceName: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const dev = devices.find(d => d.id === deviceDocId);
    if (dev && dev.type === 'rental' && dev.ownerId !== user?.uid) {
      if (!confirm(`Cancel/Stop renting "${deviceName}"?`)) return;
      setDeletingId(deviceDocId);
      try {
        // Find running session for this device
        const q = query(
          collection(db, 'rentals'),
          where('deviceId', '==', dev.deviceId),
          where('status', '==', 'running')
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const sessionDoc = snap.docs[0];
          const sessionData = { id: sessionDoc.id, ...sessionDoc.data() } as any;
          
          // Read active session state from RTDB to get the latest elapsed seconds/earnings
          const { ref, get } = await import('firebase/database');
          const { rtdb } = await import('@/lib/firebase');
          const rtdbSnap = await get(ref(rtdb, `devices/${dev.deviceId}/activeRentalSession`));
          
          let finalBalance = sessionData.earnedBalance;
          if (rtdbSnap.exists()) {
            finalBalance = rtdbSnap.val().earnedBalance || 0;
          }

          // Pay the host
          await addHostBalance(sessionData.ownerUserId, finalBalance);

          // Update rental in Firestore
          await updateDoc(doc(db, 'rentals', sessionData.id), {
            status: 'completed',
            endTime: Date.now(),
            earnedBalance: finalBalance
          });

          // Delete active session in RTDB
          await stopActiveRentalSessionRTDB(dev.deviceId, sessionData.id, 'completed');
        }

        // Unlink renterUserId in Firestore device document
        await updateDoc(doc(db, 'devices', dev.id), {
          rentalStatus: 'idle',
          rentalSessionId: null,
          renterUserId: null
        });

        alert('Rented device removed successfully!');
      } catch (err: any) {
        alert('Failed to remove rented device: ' + err.message);
      } finally {
        setDeletingId(null);
      }
      return;
    }

    if (!confirm(`Remove "${deviceName}" from your dashboard?\n\nThe agent will continue running on that PC but will no longer be tracked here.`)) return;
    setDeletingId(deviceDocId);
    try {
      await deleteDevice(deviceDocId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = devices.filter(d => {
    const matchesSearch = !search ||
      d.name?.toLowerCase().includes(search.toLowerCase()) ||
      d.deviceId.toLowerCase().includes(search.toLowerCase()) ||
      d.machineName?.toLowerCase().includes(search.toLowerCase());

    const online = metricsMap[d.deviceId]?.status === 'online';
    const matchesFilter =
      filter === 'all' ||
      (filter === 'online' && online) ||
      (filter === 'offline' && !online);

    return matchesSearch && matchesFilter;
  });

  const handlePair = async () => {
    if (!pairCode || !user) return;
    setPairLoading(true);
    setPairError('');

    try {
      // Consume pair code from RTDB first
      const rtdbDevice = await consumePairCode(pairCode.toUpperCase());

      if (!rtdbDevice) {
        // Pair directly through Firestore if agent didn't register in RTDB
        await pairDevice(user.uid, pairCode.toUpperCase());
      } else {
        // Create device document in Firestore
        const { doc, setDoc } = await import('firebase/firestore');
        const { db } = await import('@/lib/firebase');
        await setDoc(doc(db, 'devices', rtdbDevice.deviceId), {
          deviceId: rtdbDevice.deviceId,
          pairCode: pairCode.toUpperCase(),
          name: deviceName || rtdbDevice.machineName,
          machineName: rtdbDevice.machineName,
          ownerId: user.uid,
          paired: true,
          createdAt: Date.now(),
          lastSeen: Date.now(),
        });
        
        // Sync paired state to RTDB so agent knows it is paired
        const { ref, set } = await import('firebase/database');
        const { rtdb } = await import('@/lib/firebase');
        await set(ref(rtdb, `devices/${rtdbDevice.deviceId}/paired`), true);
      }

      setPairSuccess(true);
      setTimeout(() => {
        setShowAddDialog(false);
        setPairCode('');
        setDeviceName('');
        setPairSuccess(false);
      }, 2000);
    } catch (err: unknown) {
      setPairError(err instanceof Error ? err.message : 'Failed to pair device');
    } finally {
      setPairLoading(false);
    }
  };

  const onlineCount = devices.filter(d => metricsMap[d.deviceId]?.status === 'online').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Devices</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {onlineCount} of {devices.length} devices online
          </p>
        </div>
        <button
          onClick={() => setShowAddDialog(true)}
          className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-400 text-black font-semibold rounded-lg text-sm transition-all"
        >
          <Plus className="w-4 h-4" />
          Add Device
        </button>
      </div>

      {/* Filters + Search */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search devices..."
            className="w-full pl-9 pr-4 py-2 bg-slate-900/60 border border-slate-800 rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-green-500/40"
          />
        </div>
        {(['all', 'online', 'offline'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
              filter === f
                ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                : 'text-slate-400 border border-slate-800 hover:border-slate-700'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Device Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <Monitor className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="font-medium">No devices found</p>
          <p className="text-sm mt-1">
            {devices.length === 0
              ? 'Click "Add Device" to pair your first PC'
              : 'Try adjusting your search or filter'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((device, i) => {
            const metrics = metricsMap[device.deviceId];
            const online = metrics?.status === 'online';
            const isMobile = device.deviceId.startsWith('MOB');
            const DeviceIcon = isMobile ? Smartphone : Monitor;

            return (
              <motion.div
                key={device.id}
                custom={i}
                variants={fadeUp}
                initial="initial"
                animate="animate"
              >
                <div className="relative group/card">
                  {/* Delete button */}
                  <button
                    onClick={(e) => handleDelete(device.id, device.name || device.machineName, e)}
                    disabled={deletingId === device.id}
                    className="absolute top-2 right-2 z-10 opacity-0 group-hover/card:opacity-100 transition-opacity w-7 h-7 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 flex items-center justify-center"
                    title="Remove device"
                  >
                    {deletingId === device.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                <Link href={`/device/?id=${device.deviceId}`}>
                  <div className={`glass-card p-5 hover-card ${online ? 'border-slate-700/60' : 'border-slate-800/40 opacity-70'}`}>
                    {/* Card header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          online ? 'bg-green-500/10 border border-green-500/20' : 'bg-slate-800/60 border border-slate-700/60'
                        }`}>
                          <DeviceIcon className={`w-5 h-5 ${online ? 'text-green-400' : 'text-slate-500'}`} />
                        </div>
                        <div>
                          <div className="font-semibold text-white text-sm">
                            {device.name || device.machineName}
                          </div>
                          <div className="text-xs text-slate-500">{device.deviceId}</div>
                        </div>
                      </div>
                      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
                        online
                          ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                          : 'bg-slate-800 text-slate-500'
                      }`}>
                        {online ? (
                          <><div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />Online</>
                        ) : (
                          <><div className="w-1.5 h-1.5 rounded-full bg-slate-600" />Offline</>
                        )}
                      </div>
                    </div>

                    {/* Metrics */}
                    {online && metrics ? (
                      <div className="space-y-2.5">
                        {[
                          { label: 'CPU', value: metrics.cpu.total, icon: Cpu, color: '#3b82f6' },
                          { label: 'RAM', value: metrics.ram.usedPercent, icon: MemoryStick, color: '#8b5cf6' },
                          { label: 'GPU', value: metrics.gpu.usagePercent, icon: Zap, color: '#f59e0b' },
                        ].map(m => (
                          <div key={m.label}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5">
                                <m.icon className="w-3 h-3" style={{ color: m.color }} />
                                <span className="text-xs text-slate-400">{m.label}</span>
                              </div>
                              <span className="text-xs font-mono text-slate-300">
                                {m.value.toFixed(1)}%
                              </span>
                            </div>
                            <div className="metric-bar">
                              <div
                                className="metric-bar-fill"
                                style={{
                                  width: `${m.value}%`,
                                  background: m.value > 85 ? '#ef4444' : m.value > 70 ? '#f59e0b' : m.color
                                }}
                              />
                            </div>
                          </div>
                        ))}

                        {/* Temperature */}
                        <div className="flex items-center justify-between pt-1 border-t border-slate-800">
                          <div className="flex items-center gap-1.5 text-xs text-slate-400">
                            <Thermometer className="w-3 h-3" />
                            CPU {Number(metrics?.temperatures?.cpu ?? 0).toFixed(0)}°C
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-400">
                            GPU {Number(metrics?.temperatures?.gpu ?? 0).toFixed(0)}°C
                            <Thermometer className="w-3 h-3" />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="h-20 flex items-center justify-center text-slate-600 text-sm">
                        No data available
                      </div>
                    )}
                  </div>
                </Link>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Add Device Dialog */}
      <AnimatePresence>
        {showAddDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setShowAddDialog(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="glass-card p-6 w-full max-w-md border border-slate-700"
            >
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                  <Link2 className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <h2 className="font-semibold text-white">Add New Device</h2>
                  <p className="text-xs text-slate-400">
                    Enter the pair code from your agent. Don't have it? Download:{' '}
                    <a href="/downloads/ClusterOSAgent.zip" download className="text-green-400 hover:underline">
                      PC Agent (.zip)
                    </a>
                    {' | '}
                    <a href="/downloads/ClusterOSMobileAgent.zip" download className="text-green-400 hover:underline">
                      Mobile Agent (.zip)
                    </a>
                  </p>
                </div>
              </div>

              {pairSuccess ? (
                <div className="text-center py-6">
                  <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-3">
                    <Monitor className="w-6 h-6 text-green-400" />
                  </div>
                  <p className="text-green-400 font-medium">Device paired successfully!</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Pair Code</label>
                    <input
                      type="text"
                      value={pairCode}
                      onChange={e => setPairCode(e.target.value.toUpperCase())}
                      placeholder="e.g. A8K2M9"
                      maxLength={6}
                      className="w-full px-4 py-3 bg-slate-900/60 border border-slate-700 rounded-lg text-white placeholder-slate-500 text-sm font-mono tracking-widest focus:outline-none focus:border-green-500/50 uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Device Name (optional)</label>
                    <input
                      type="text"
                      value={deviceName}
                      onChange={e => setDeviceName(e.target.value)}
                      placeholder="e.g. Render Node 1"
                      className="w-full px-4 py-3 bg-slate-900/60 border border-slate-700 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-green-500/50"
                    />
                  </div>

                  {pairError && (
                    <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
                      {pairError}
                    </p>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowAddDialog(false)}
                      className="flex-1 py-2.5 border border-slate-700 text-slate-400 hover:text-white rounded-lg text-sm transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handlePair}
                      disabled={pairLoading || pairCode.length < 6}
                      className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-semibold rounded-lg text-sm transition-all flex items-center justify-center gap-2"
                    >
                      {pairLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                      {pairLoading ? 'Pairing...' : 'Pair Device'}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
