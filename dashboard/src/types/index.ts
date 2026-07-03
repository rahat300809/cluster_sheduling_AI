// ─── Device & Metrics Types ───────────────────────────────────────────────────

export interface DeviceIdentity {
  deviceId: string;
  pairCode: string;
  name: string;
  machineName: string;
  ownerId: string;
  clusterId?: string;
  paired: boolean;
  createdAt: number;
  lastSeen: number;
}

export interface CpuMetrics {
  total: number;
  cores: number[];
  name: string;
  load1?: number;   // 1-min avg load %
  load5?: number;   // 5-min avg load %
  load15?: number;  // 15-min avg load %
}

export interface RamMetrics {
  usedPercent: number;
  used: number;       // GB
  total: number;      // GB
  available: number;  // GB
}

export interface GpuMetrics {
  usagePercent: number;
  memUsedPercent: number;
  memUsed: number;    // MB
  memTotal: number;   // MB
  name: string;
}

export interface DiskMetrics {
  usedPercent: number;
  used: number;          // GB
  total: number;         // GB
  driveName: string;
  readMbps?: number;     // Disk read speed MB/s
  writeMbps?: number;    // Disk write speed MB/s
}

export interface NetworkMetrics {
  uploadMbps: number;
  downloadMbps: number;
  adapterName: string;
  latencyMs?: number;    // Ping latency in ms
}

export interface TemperatureMetrics {
  cpu: number;
  gpu: number;
}

export interface SystemSnapshot {
  timestamp: number;
  cpu: CpuMetrics;
  ram: RamMetrics;
  gpu: GpuMetrics;
  disk: DiskMetrics;
  network: NetworkMetrics;
  temperatures: TemperatureMetrics;
  status: 'online' | 'offline';
  // Enhanced fields
  uptimeSeconds?: number;
  batteryPercent?: number;
  powerPluggedIn?: boolean;
  runningTasks?: number;
  waitingTasks?: number;
  heartbeatAt?: number;
  healthStatus?: 'healthy' | 'degraded' | 'critical';
  successRate?: number;
  failureRate?: number;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpuPercent: number;
  ramMB: number;
  status: string;
}

export interface Device {
  id: string;
  deviceId: string;
  name: string;
  machineName: string;
  ownerId: string;
  clusterId?: string;
  paired: boolean;
  pairCode: string;
  createdAt: number;
  lastSeen: number;
  metrics?: SystemSnapshot;
  processes?: ProcessInfo[];
  type?: 'standard' | 'rental';
  rentalStatus?: 'idle' | 'rented';
  rentalSessionId?: string | null;
}

// ─── Cluster Types ────────────────────────────────────────────────────────────

export interface Cluster {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  deviceIds: string[];
  createdAt: number;
  color?: string;
}

export interface ClusterStats {
  totalDevices: number;
  onlineDevices: number;
  totalCpuCores: number;
  avgCpuPercent: number;
  totalRamGB: number;
  usedRamGB: number;
  avgGpuPercent: number;
}

// ─── Scheduler Types ──────────────────────────────────────────────────────────

/** Configurable scoring weights — must sum to 1.0 */
export interface SchedulerWeights {
  cpu: number;
  ram: number;
  gpu: number;
  temperature: number;
  network: number;
  queue: number;
  reliability: number;
  disk: number;
}

export const DEFAULT_SCHEDULER_WEIGHTS: SchedulerWeights = {
  cpu: 0.30,
  ram: 0.20,
  gpu: 0.10,
  temperature: 0.10,
  network: 0.10,
  queue: 0.10,
  reliability: 0.05,
  disk: 0.05,
};

/** Per-node score breakdown */
export interface NodeScoreBreakdown {
  deviceId: string;
  deviceName: string;
  cpuUsage: number;
  ramUsage: number;
  gpuUsage: number;
  cpuTemp: number;
  gpuTemp: number;
  latencyMs: number;
  runningTasks: number;
  waitingTasks: number;
  diskUsage: number;
  successRate: number;
  batteryPercent: number | null;
  powerPluggedIn: boolean | null;
  uptimeHours: number;
  diskReadMbps: number;
  diskWriteMbps: number;
  downloadMbps: number;
  uploadMbps: number;
  cpuScore: number;
  ramScore: number;
  gpuScore: number;
  temperatureScore: number;
  networkScore: number;
  queueScore: number;
  reliabilityScore: number;
  diskScore: number;
  finalScore: number;
  averagePerformance?: number;
  status: 'online' | 'offline';
  healthStatus: string;
  eliminated: boolean;
  eliminationReason?: string;
}

/** Full scheduler decision result */
export interface SchedulerDecision {
  timestamp: number;
  selectedDeviceId: string;
  selectedDeviceName: string;
  finalScore: number;
  rank: number;
  totalConsidered: number;
  confidence: number;
  routingReason: string;
  positiveFacts: string[];
  tiebroken: boolean;
  tiebreakMethod?: string;
  weights: SchedulerWeights;
  rankedNodes: NodeScoreBreakdown[];
  eliminatedNodes: NodeScoreBreakdown[];
  expectedCompletionMinutes?: number;
}

// ─── Job Types ────────────────────────────────────────────────────────────────

export type JobType = 'python' | 'batch' | 'exe';
export type JobStatus = 'queued' | 'installing' | 'running' | 'completed' | 'failed';

export interface Job {
  id: string;
  name: string;
  type: JobType;
  script: string;
  targetDeviceIds: string[];
  targetClusterId?: string;
  status: JobStatus;
  ownerId: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  output?: string;
  priority?: number;
  forceWork?: boolean;
  aiReport?: SchedulerDecision;
}

// ─── Command Types ────────────────────────────────────────────────────────────

export type CommandType =
  | 'shutdown'
  | 'restart'
  | 'sleep'
  | 'lock'
  | 'kill_process'
  | 'run_exe'
  | 'run_script'
  | 'run_cmd';

export type CommandStatus = 'pending' | 'success' | 'failed';

export interface Command {
  id: string;
  deviceId: string;
  deviceName?: string;
  type: CommandType;
  payload: Record<string, unknown>;
  status: CommandStatus;
  issuedBy: string;
  issuedAt: number;
  completedAt?: number;
  output?: string;
}

// ─── User & Auth Types ────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'operator' | 'viewer';

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  role: UserRole;
  createdAt: number;
  photoURL?: string;
}

// ─── Analytics Types ──────────────────────────────────────────────────────────

export interface MetricPoint {
  timestamp: number;
  value: number;
}

export interface DeviceMetricHistory {
  deviceId: string;
  cpu: MetricPoint[];
  ram: MetricPoint[];
  gpu: MetricPoint[];
}

// ─── Load Balancer Types ──────────────────────────────────────────────────────

export interface LoadRecommendation {
  sourceDeviceId: string;
  targetDeviceId: string;
  reason: string;
  targetCpuPercent: number;
  targetRamPercent: number;
}
