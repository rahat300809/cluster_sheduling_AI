'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { subscribeDevices, subscribeClusters, subscribeJobs, subscribeCommands, subscribeUserRentals } from '@/lib/db';
import { subscribeDeviceMetrics, subscribeDeviceProcesses } from '@/lib/rtdb';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { SystemSnapshot, Device } from '@/types';

// How long (ms) without a metrics update before we consider a device offline.
// Metrics are published every 5s; give 3× headroom = 15s.
const STALE_THRESHOLD_MS = 15_000;

export default function DashboardRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const { user: appUser, setDevices, setClusters, setJobs, setCommands, setDeviceMetrics, setDeviceProcesses, devices } = useAppStore();
  const metricsUnsubscribers = useRef<Map<string, () => void>>(new Map());
  // Per-device staleness timers: fires when no update received within STALE_THRESHOLD_MS
  const stalenessTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!appUser) return;

    let firestoreDevices: Device[] = [];
    let rentedDevices: Device[] = [];
    let rentedUnsubs: (() => void)[] = [];

    const updateMergedDevices = () => {
      const merged = [...firestoreDevices];
      rentedDevices.forEach(rd => {
        if (!merged.some(md => md.deviceId === rd.deviceId)) {
          merged.push(rd);
        }
      });
      setDevices(merged);
    };

    // 1. Subscribe to owned devices
    const unsubDevices = subscribeDevices(appUser.uid, (updatedDevices) => {
      firestoreDevices = updatedDevices;
      updateMergedDevices();
    });

    // 2. Subscribe to active running rentals to fetch rented devices
    const unsubRentals = subscribeUserRentals(appUser.uid, 'renter', (sessions) => {
      rentedUnsubs.forEach(unsub => unsub());
      rentedUnsubs = [];
      rentedDevices = [];

      const activeSessions = sessions.filter(s => s.status === 'running');
      if (activeSessions.length === 0) {
        updateMergedDevices();
        return;
      }

      let loadedCount = 0;
      activeSessions.forEach(session => {
        const unsubDeviceDoc = onSnapshot(doc(db, 'devices', session.deviceId), (snap) => {
          if (snap.exists()) {
            const devData = { id: snap.id, ...snap.data() } as Device;
            const idx = rentedDevices.findIndex(rd => rd.deviceId === devData.deviceId);
            if (idx >= 0) {
              rentedDevices[idx] = devData;
            } else {
              rentedDevices.push(devData);
            }
          }
          loadedCount++;
          if (loadedCount >= activeSessions.length) {
            updateMergedDevices();
          }
        }, (err) => {
          console.error("Failed to subscribe to rented device doc:", err);
          loadedCount++;
          if (loadedCount >= activeSessions.length) {
            updateMergedDevices();
          }
        });
        rentedUnsubs.push(unsubDeviceDoc);
      });
    });

    const unsubClusters = subscribeClusters(appUser.uid, setClusters);
    const unsubJobs = subscribeJobs(appUser.uid, setJobs);
    const unsubCommands = subscribeCommands(appUser.uid, setCommands);

    return () => {
      unsubDevices();
      unsubRentals();
      rentedUnsubs.forEach(unsub => unsub());
      unsubClusters();
      unsubJobs();
      unsubCommands();
    };
  }, [appUser]);

  // Subscribe to RTDB metrics for each device
  useEffect(() => {
    const currentDeviceIds = new Set(devices.map(d => d.deviceId));
    const subscribedIds = new Set(metricsUnsubscribers.current.keys());

    const resetStalenessTimer = (deviceId: string) => {
      // Clear existing timer
      const existing = stalenessTimers.current.get(deviceId);
      if (existing) clearTimeout(existing);

      // Set a new timer: if no update in STALE_THRESHOLD_MS, mark device offline
      const timer = setTimeout(() => {
        setDeviceMetrics(deviceId, {
          ...useAppStore.getState().metricsMap[deviceId],
          status: 'offline',
        } as SystemSnapshot);
      }, STALE_THRESHOLD_MS);

      stalenessTimers.current.set(deviceId, timer);
    };

    // Subscribe to new devices
    for (const device of devices) {
      if (!subscribedIds.has(device.deviceId)) {
        const unsubMetrics = subscribeDeviceMetrics(device.deviceId, (metrics) => {
          if (metrics) {
            // Only trust status:online if the timestamp is recent
            const now = Date.now();
            const isStale = metrics.timestamp
              ? now - metrics.timestamp > STALE_THRESHOLD_MS
              : false;
            const resolvedMetrics: SystemSnapshot = isStale
              ? { ...metrics, status: 'offline' }
              : metrics;
            setDeviceMetrics(device.deviceId, resolvedMetrics);

            // If the agent just reported online, reset the staleness timer
            if (!isStale) resetStalenessTimer(device.deviceId);
          } else {
            // Null means the node was deleted — device is offline
            setDeviceMetrics(device.deviceId, {
              ...useAppStore.getState().metricsMap[device.deviceId],
              status: 'offline',
            } as SystemSnapshot);
          }
        });
        const unsubProcesses = subscribeDeviceProcesses(device.deviceId, (processes) => {
          setDeviceProcesses(device.deviceId, processes);
        });

        // Start an initial staleness timer for this device
        resetStalenessTimer(device.deviceId);

        metricsUnsubscribers.current.set(device.deviceId, () => {
          unsubMetrics();
          unsubProcesses();
        });
      }
    }

    // Unsubscribe from removed devices and clear their timers
    for (const [deviceId, unsub] of metricsUnsubscribers.current) {
      if (!currentDeviceIds.has(deviceId)) {
        unsub();
        metricsUnsubscribers.current.delete(deviceId);
        const t = stalenessTimers.current.get(deviceId);
        if (t) { clearTimeout(t); stalenessTimers.current.delete(deviceId); }
      }
    }
  }, [devices]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-green-400 animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Initializing ClusterOS...</p>
        </div>
      </div>
    );
  }

  if (!user) return null; // AuthProvider will redirect to /login

  return (
    <DashboardLayout>
      {children}
    </DashboardLayout>
  );
}
