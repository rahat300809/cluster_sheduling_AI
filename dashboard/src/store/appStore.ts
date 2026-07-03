import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Device, Cluster, Job, Command, UserProfile, SystemSnapshot, ProcessInfo } from '@/types';

interface AppState {
  // Auth
  user: UserProfile | null;
  setUser: (user: UserProfile | null) => void;

  // Devices
  devices: Device[];
  setDevices: (devices: Device[]) => void;
  updateDevice: (id: string, updates: Partial<Device>) => void;

  // Live metrics per device
  metricsMap: Record<string, SystemSnapshot>;
  setDeviceMetrics: (deviceId: string, metrics: SystemSnapshot) => void;

  // Processes per device
  processesMap: Record<string, ProcessInfo[]>;
  setDeviceProcesses: (deviceId: string, processes: ProcessInfo[]) => void;

  // Clusters
  clusters: Cluster[];
  setClusters: (clusters: Cluster[]) => void;

  // Jobs
  jobs: Job[];
  setJobs: (jobs: Job[]) => void;

  // Commands
  commands: Command[];
  setCommands: (commands: Command[]) => void;

  // UI State
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  selectedDeviceId: string | null;
  setSelectedDeviceId: (id: string | null) => void;
}

export const useAppStore = create<AppState>()(
  devtools(
    (set, get) => ({
      // Auth
      user: null,
      setUser: (user) => set({ user }),

      // Devices
      devices: [],
      setDevices: (devices) => set({ devices }),
      updateDevice: (id, updates) => set(state => ({
        devices: state.devices.map(d => d.id === id ? { ...d, ...updates } : d)
      })),

      // Live metrics
      metricsMap: {},
      setDeviceMetrics: (deviceId, metrics) => set(state => ({
        metricsMap: { ...state.metricsMap, [deviceId]: metrics }
      })),

      // Processes
      processesMap: {},
      setDeviceProcesses: (deviceId, processes) => set(state => ({
        processesMap: { ...state.processesMap, [deviceId]: processes }
      })),

      // Clusters
      clusters: [],
      setClusters: (clusters) => set({ clusters }),

      // Jobs
      jobs: [],
      setJobs: (jobs) => set({ jobs }),

      // Commands
      commands: [],
      setCommands: (commands) => set({ commands }),

      // UI
      sidebarCollapsed: false,
      toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      selectedDeviceId: null,
      setSelectedDeviceId: (id) => set({ selectedDeviceId: id }),
    }),
    { name: 'ClusterOS' }
  )
);

// Derived selectors
export const selectOnlineDevices = (state: AppState) =>
  state.devices.filter(d => {
    const m = state.metricsMap[d.deviceId];
    return m?.status === 'online' && (Date.now() - (m.timestamp ?? 0)) < 15000;
  });

export const selectOfflineDevices = (state: AppState) =>
  state.devices.filter(d => {
    const m = state.metricsMap[d.deviceId];
    return !m || m.status !== 'online' || (Date.now() - (m.timestamp ?? 0)) >= 15000;
  });

export const selectClusterStats = (clusterId: string) => (state: AppState) => {
  const cluster = state.clusters.find(c => c.id === clusterId);
  if (!cluster) return null;

  const clusterDevices = state.devices.filter(d => cluster.deviceIds.includes(d.deviceId));
  const onlineCount = clusterDevices.filter(d => {
    const m = state.metricsMap[d.deviceId];
    return m?.status === 'online' && (Date.now() - (m.timestamp ?? 0)) < 15000;
  }).length;

  let totalCpu = 0, totalRam = 0, usedRam = 0, totalGpu = 0;

  for (const device of clusterDevices) {
    const m = state.metricsMap[device.deviceId];
    if (m) {
      totalCpu += m.cpu.total;
      totalRam += m.ram.total;
      usedRam += m.ram.used;
      totalGpu += m.gpu.usagePercent;
    }
  }

  return {
    totalDevices: clusterDevices.length,
    onlineDevices: onlineCount,
    avgCpuPercent: clusterDevices.length ? totalCpu / clusterDevices.length : 0,
    totalRamGB: totalRam,
    usedRamGB: usedRam,
    avgGpuPercent: clusterDevices.length ? totalGpu / clusterDevices.length : 0,
  };
};
