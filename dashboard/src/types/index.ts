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
  gpuMemTotal: number;    // GPU VRAM in MB (0 = no dedicated GPU)
  gpuName: string;        // GPU hardware name for display
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
  notebookId?: string;
  artifacts?: JobArtifact[]; // Saved artifacts for this job
  // Distributed training fields
  distributedSessionId?: string;  // Links to a DistributedTrainingSession
  shardIndex?: number;            // 0-based shard index for this node
  totalShards?: number;           // Total number of nodes/shards
  isDistributed?: boolean;        // Flags this as part of a distributed run
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

// ─── Notebook Types (Colab-like Training Studio) ──────────────────────────────

export interface NotebookDatasetFile {
  name: string;           // Original filename
  storagePath: string;    // Firebase Storage path
  downloadUrl: string;    // Signed download URL
  size: number;           // Bytes
  type: string;           // MIME type
  uploadedAt: number;     // Unix ms timestamp
  accessToken?: string;   // Google Drive API download token
}

export type NotebookStatus = 'idle' | 'uploading' | 'queued' | 'installing' | 'running' | 'completed' | 'failed';

export interface Notebook {
  id: string;
  name: string;
  ownerId: string;
  code: string;           // Python script content
  datasets: NotebookDatasetFile[];
  targetMode: 'cluster' | 'dedicated';
  targetClusterId?: string;
  targetDeviceId?: string;
  status: NotebookStatus;
  forceWork: boolean;
  createdAt: number;
  lastRunAt?: number;
  lastOutput?: string;
  lastJobId?: string;     // Link to the dispatched job
  aiReport?: SchedulerDecision;
}

// ─── Job Artifact Types (Model Downloads) ──────────────────────────────────

export interface JobArtifact {
  name: string;           // Filename (e.g. "model.pkl", "results.csv")
  storagePath: string;    // Firebase Storage path
  downloadUrl: string;    // Direct download URL with token
  size: number;           // Bytes
  uploadedAt: number;     // Unix ms timestamp
}

// ─── Distributed Training Types ────────────────────────────────────────────────

export type DistributedSessionStatus =
  | 'configuring'
  | 'launching'
  | 'running'
  | 'aggregating'
  | 'completed'
  | 'failed'
  | 'partial';

export interface DistributedNodeStatus {
  deviceId: string;
  deviceName: string;
  jobId: string;
  shardIndex: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;       // 0–100 estimated from output parsing
  lastLine?: string;      // Last output line from this node
  artifacts?: JobArtifact[];
  startedAt?: number;
  completedAt?: number;
}

export interface DistributedTrainingSession {
  id: string;
  notebookId: string;
  notebookName: string;
  ownerId: string;
  deviceIds: string[];          // All participating device IDs
  totalShards: number;          // == deviceIds.length
  jobIds: string[];             // One job per device
  status: DistributedSessionStatus;
  nodeStatuses: DistributedNodeStatus[];
  createdAt: number;
  launchedAt?: number;
  completedAt?: number;
  strategy: 'data_parallel';    // Future: 'model_parallel'
  aggregatedArtifacts?: JobArtifact[];
}

