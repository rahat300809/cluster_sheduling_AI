/**
 * ClusterOS Intelligent Scheduler Engine
 *
 * Production-grade workload dispatcher inspired by Kubernetes, Slurm, and HTCondor.
 * Every decision is fully explainable, reproducible, and traceable.
 *
 * Scoring formula:
 *   Score = 0.30×CPU + 0.20×RAM + 0.10×GPU + 0.10×Temp + 0.10×Network + 0.10×Queue + 0.05×Reliability + 0.05×Disk
 *
 * All weights are configurable from the UI.
 */

import type {
  Device,
  SystemSnapshot,
  SchedulerWeights,
  NodeScoreBreakdown,
  SchedulerDecision,
} from '@/types';
import { DEFAULT_SCHEDULER_WEIGHTS } from '@/types';

// ─── Thresholds for node elimination ─────────────────────────────────────────

const THRESHOLDS = {
  maxCpuTemp: 90,       // °C
  maxGpuTemp: 95,       // °C
  maxRamUsage: 95,      // %
  maxDiskUsage: 95,     // %
  maxQueuedTasks: 20,
  heartbeatTimeoutMs: 45_000,  // 45 seconds
};

// ─── Safe operating ranges for score normalisation ───────────────────────────

const SAFE_TEMP_MAX = 80;   // °C — anything above this degrades score
const IDEAL_LATENCY = 5;    // ms — ideal ping
const MAX_LATENCY = 200;    // ms — worst acceptable ping
const MAX_QUEUE = 10;       // tasks — above this, queue score → 0

// ─── Round-robin counter (in-memory, resets on page reload) ──────────────────
let rrCounter = 0;

// ─── Utility helpers ──────────────────────────────────────────────────────────

function num(val: unknown, fallback = 0): number {
  const n = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(val: number, min = 0, max = 100) {
  const n = num(val);
  return Math.max(min, Math.min(max, n));
}

/**
 * Compute CPU availability score (0–100).
 * Uses 5-min load average if available, otherwise current usage.
 */
function cpuScore(m: SystemSnapshot): number {
  const usage = num(m.cpu?.load5 ?? m.cpu?.total);
  return clamp(100 - usage);
}

/** RAM availability score (0–100). */
function ramScore(m: SystemSnapshot): number {
  return clamp(100 - num(m.ram?.usedPercent));
}

/** GPU availability score (0–100). GPU memory pressure also penalised. */
function gpuScore(m: SystemSnapshot): number {
  const usage = (num(m.gpu?.usagePercent) + num(m.gpu?.memUsedPercent)) / 2;
  return clamp(100 - usage);
}

/**
 * Temperature score (0–100).
 * Perfect = both temps below 50°C. Degrades linearly to 0 at threshold.
 */
function temperatureScore(m: SystemSnapshot): number {
  const cpuT = m.temperatures?.cpu || 0;
  const gpuT = m.temperatures?.gpu || 0;
  const worst = Math.max(cpuT, gpuT);
  if (worst <= 50) return 100;
  if (worst >= SAFE_TEMP_MAX) return 0;
  return clamp(100 - ((worst - 50) / (SAFE_TEMP_MAX - 50)) * 100);
}

/**
 * Network score (0–100).
 * Latency: 0ms ideal → 100 score, 200ms → 0 score.
 * Also rewards high download throughput.
 */
function networkScore(m: SystemSnapshot): number {
  const latency = m.network?.latencyMs ?? 10;
  const latencyScore = clamp(100 - ((latency - IDEAL_LATENCY) / (MAX_LATENCY - IDEAL_LATENCY)) * 100);
  const throughputScore = clamp(Math.min((m.network?.downloadMbps ?? 0) / 10, 1) * 100); // 10 Mbps = 100
  return clamp((latencyScore * 0.7) + (throughputScore * 0.3));
}

/**
 * Queue score (0–100).
 * Zero tasks = 100. MAX_QUEUE+ tasks = 0.
 * Penalises waiting tasks more than running tasks.
 */
function queueScore(m: SystemSnapshot): number {
  const running = m.runningTasks ?? 0;
  const waiting = m.waitingTasks ?? 0;
  const weighted = running + waiting * 1.5;
  return clamp(100 - (weighted / MAX_QUEUE) * 100);
}

/**
 * Reliability score (0–100).
 * Based on historical success rate. Defaults to 80 if unknown.
 */
function reliabilityScore(m: SystemSnapshot): number {
  return clamp(m.successRate ?? 80);
}

/**
 * Disk score (0–100).
 * Penalises high disk usage and low I/O throughput.
 */
function diskScore(m: SystemSnapshot): number {
  const usageScore = clamp(100 - (m.disk?.usedPercent ?? 0));
  const readScore = clamp(Math.min((m.disk?.readMbps ?? 50) / 200, 1) * 100);  // 200 MB/s = 100
  const writeScore = clamp(Math.min((m.disk?.writeMbps ?? 50) / 200, 1) * 100);
  return clamp((usageScore * 0.5) + (readScore * 0.25) + (writeScore * 0.25));
}

// ─── Elimination Filter ───────────────────────────────────────────────────────

/**
 * Returns a reason string if the node should be eliminated, or null if healthy.
 */
function eliminationReason(m: SystemSnapshot | undefined, lastSeen: number): string | null {
  if (!m || m.status !== 'online') return 'Node is offline';

  const heartbeatAge = Date.now() - (m.heartbeatAt ?? m.timestamp ?? 0);
  if (heartbeatAge > THRESHOLDS.heartbeatTimeoutMs) {
    return `Missed heartbeat (last seen ${Math.round(heartbeatAge / 1000)}s ago)`;
  }

  if (m.healthStatus === 'critical') return 'Node health status: CRITICAL';
  if ((m.temperatures?.cpu ?? 0) >= THRESHOLDS.maxCpuTemp)
    return `CPU temperature critical (${(m.temperatures?.cpu ?? 0).toFixed(0)}°C ≥ ${THRESHOLDS.maxCpuTemp}°C)`;
  if ((m.temperatures?.gpu ?? 0) >= THRESHOLDS.maxGpuTemp)
    return `GPU temperature critical (${(m.temperatures?.gpu ?? 0).toFixed(0)}°C ≥ ${THRESHOLDS.maxGpuTemp}°C)`;
  if ((m.ram?.usedPercent ?? 0) >= THRESHOLDS.maxRamUsage)
    return `RAM usage critical (${(m.ram?.usedPercent ?? 0).toFixed(0)}% ≥ ${THRESHOLDS.maxRamUsage}%)`;
  if ((m.disk?.usedPercent ?? 0) >= THRESHOLDS.maxDiskUsage)
    return `Disk usage critical (${(m.disk?.usedPercent ?? 0).toFixed(0)}% ≥ ${THRESHOLDS.maxDiskUsage}%)`;
  if ((m.waitingTasks ?? 0) >= THRESHOLDS.maxQueuedTasks)
    return `Queue overloaded (${m.waitingTasks} waiting tasks)`;

  return null;
}

// ─── Node Scorer ─────────────────────────────────────────────────────────────

function buildNodeBreakdown(
  device: Device,
  m: SystemSnapshot | undefined,
  weights: SchedulerWeights,
  isEliminated: boolean,
  elimReason?: string
): NodeScoreBreakdown {
  const name = device.name || device.machineName;

  if (!m || isEliminated) {
    return {
      deviceId: device.deviceId,
      deviceName: name,
      cpuUsage: m?.cpu?.total ?? 0,
      ramUsage: m?.ram?.usedPercent ?? 0,
      gpuUsage: m?.gpu?.usagePercent ?? 0,
      cpuTemp: m?.temperatures?.cpu ?? 0,
      gpuTemp: m?.temperatures?.gpu ?? 0,
      latencyMs: m?.network?.latencyMs ?? 0,
      runningTasks: m?.runningTasks ?? 0,
      waitingTasks: m?.waitingTasks ?? 0,
      diskUsage: m?.disk?.usedPercent ?? 0,
      successRate: m?.successRate ?? 80,
      batteryPercent: m?.batteryPercent ?? null,
      powerPluggedIn: m?.powerPluggedIn ?? null,
      uptimeHours: (m?.uptimeSeconds ?? 0) / 3600,
      diskReadMbps: m?.disk?.readMbps ?? 0,
      diskWriteMbps: m?.disk?.writeMbps ?? 0,
      downloadMbps: m?.network?.downloadMbps ?? 0,
      uploadMbps: m?.network?.uploadMbps ?? 0,
      cpuScore: 0,
      ramScore: 0,
      gpuScore: 0,
      temperatureScore: 0,
      networkScore: 0,
      queueScore: 0,
      reliabilityScore: 0,
      diskScore: 0,
      finalScore: 0,
      averagePerformance: 0,
      status: m?.status ?? 'offline',
      healthStatus: m?.healthStatus ?? 'critical',
      eliminated: true,
      ...(elimReason ? { eliminationReason: elimReason } : {}),
    };
  }

  const cs = cpuScore(m);
  const rs = ramScore(m);
  const gs = gpuScore(m);
  const ts = temperatureScore(m);
  const ns = networkScore(m);
  const qs = queueScore(m);
  const rels = reliabilityScore(m);
  const ds = diskScore(m);

  const final =
    weights.cpu * cs +
    weights.ram * rs +
    weights.gpu * gs +
    weights.temperature * ts +
    weights.network * ns +
    weights.queue * qs +
    weights.reliability * rels +
    weights.disk * ds;

  return {
    deviceId: device.deviceId,
    deviceName: name,
    cpuUsage: m.cpu?.total ?? 0,
    ramUsage: m.ram?.usedPercent ?? 0,
    gpuUsage: m.gpu?.usagePercent ?? 0,
    cpuTemp: m.temperatures?.cpu ?? 0,
    gpuTemp: m.temperatures?.gpu ?? 0,
    latencyMs: m.network?.latencyMs ?? 10,
    runningTasks: m.runningTasks ?? 0,
    waitingTasks: m.waitingTasks ?? 0,
    diskUsage: m.disk?.usedPercent ?? 0,
    successRate: m.successRate ?? 80,
    batteryPercent: m.batteryPercent ?? null,
    powerPluggedIn: m.powerPluggedIn ?? null,
    uptimeHours: (m.uptimeSeconds ?? 0) / 3600,
    diskReadMbps: m.disk?.readMbps ?? 0,
    diskWriteMbps: m.disk?.writeMbps ?? 0,
    downloadMbps: m.network?.downloadMbps ?? 0,
    uploadMbps: m.network?.uploadMbps ?? 0,
    cpuScore: cs,
    ramScore: rs,
    gpuScore: gs,
    temperatureScore: ts,
    networkScore: ns,
    queueScore: qs,
    reliabilityScore: rels,
    diskScore: ds,
    finalScore: clamp(final),
    averagePerformance: (cs + rs + gs + ts + ns + qs + rels + ds) / 8,
    status: m.status,
    healthStatus: m.healthStatus ?? 'healthy',
    eliminated: false,
  };
}

// ─── Tiebreaker ───────────────────────────────────────────────────────────────

function applyTiebreaker(
  candidates: NodeScoreBreakdown[]
): { winner: NodeScoreBreakdown; method: string } {
  if (candidates.length === 1) return { winner: candidates[0], method: 'sole candidate' };

  // Sort by queue first
  const byQueue = [...candidates].sort(
    (a, b) => (a.runningTasks + a.waitingTasks) - (b.runningTasks + b.waitingTasks)
  );
  const minQueue = byQueue[0].runningTasks + byQueue[0].waitingTasks;
  const afterQueue = byQueue.filter(n => n.runningTasks + n.waitingTasks === minQueue);

  if (afterQueue.length === 1) return { winner: afterQueue[0], method: 'lowest queue depth' };

  // Then by temperature
  const byTemp = [...afterQueue].sort(
    (a, b) => Math.max(a.cpuTemp, a.gpuTemp) - Math.max(b.cpuTemp, b.gpuTemp)
  );
  const minTemp = Math.max(byTemp[0].cpuTemp, byTemp[0].gpuTemp);
  const afterTemp = byTemp.filter(n => Math.max(n.cpuTemp, n.gpuTemp) === minTemp);

  if (afterTemp.length === 1) return { winner: afterTemp[0], method: 'lowest temperature' };

  // Then by latency
  const byLatency = [...afterTemp].sort((a, b) => a.latencyMs - b.latencyMs);
  if (byLatency[0].latencyMs !== byLatency[byLatency.length - 1].latencyMs) {
    return { winner: byLatency[0], method: 'lowest network latency' };
  }

  // Round-robin
  const winner = afterTemp[rrCounter % afterTemp.length];
  rrCounter++;
  return { winner, method: 'round-robin (perfectly tied nodes)' };
}

// ─── Confidence Calculator ────────────────────────────────────────────────────

function calculateConfidence(rankedNodes: NodeScoreBreakdown[]): number {
  if (rankedNodes.length === 0) return 0;
  if (rankedNodes.length === 1) return 95;

  const winner = rankedNodes[0];
  const runnerUp = rankedNodes[1];
  const margin = winner.finalScore - runnerUp.finalScore;

  // Wide margin = high confidence
  if (margin >= 15) return 98;
  if (margin >= 10) return 93;
  if (margin >= 5)  return 87;
  if (margin >= 2)  return 78;
  return 65; // near-tie
}

// ─── Positive Facts Generator ─────────────────────────────────────────────────

function buildPositiveFacts(node: NodeScoreBreakdown, winner: NodeScoreBreakdown | null): string[] {
  const facts: string[] = [];

  if (node.cpuScore >= 70) facts.push(`Low CPU utilization (${node.cpuUsage.toFixed(0)}% usage, score ${node.cpuScore.toFixed(0)}/100)`);
  if (node.ramScore >= 70) facts.push(`Healthy memory availability (${node.ramUsage.toFixed(0)}% used, score ${node.ramScore.toFixed(0)}/100)`);
  if (node.gpuScore >= 70) facts.push(`GPU is largely idle (${node.gpuUsage.toFixed(0)}% usage, score ${node.gpuScore.toFixed(0)}/100)`);
  if (node.temperatureScore >= 80) facts.push(`Operating at safe temperature (CPU ${node.cpuTemp.toFixed(0)}°C / GPU ${node.gpuTemp.toFixed(0)}°C)`);
  if (node.networkScore >= 75) facts.push(`Excellent network performance (${node.latencyMs.toFixed(0)}ms latency, ${node.downloadMbps.toFixed(1)} Mbps download)`);
  if (node.queueScore >= 80) facts.push(`Minimal queue depth (${node.runningTasks} running, ${node.waitingTasks} waiting)`);
  if (node.reliabilityScore >= 90) facts.push(`High historical success rate (${node.successRate.toFixed(0)}%)`);
  if (node.diskScore >= 75) facts.push(`Adequate disk resources (${node.diskUsage.toFixed(0)}% used, ${node.diskReadMbps.toFixed(0)} MB/s read)`);
  if (node.powerPluggedIn === true) facts.push('Connected to AC power — no battery constraints');
  if (node.uptimeHours >= 1) facts.push(`Stable node uptime (${node.uptimeHours.toFixed(0)} hours)`);

  if (facts.length === 0) facts.push('Highest overall availability score among all candidates');
  return facts;
}

// ─── Rejection Reason Builder ─────────────────────────────────────────────────

function buildRejectionReason(node: NodeScoreBreakdown, winnerScore: number): string {
  if (node.eliminated && node.eliminationReason) return node.eliminationReason;

  const reasons: string[] = [];
  const gap = winnerScore - node.finalScore;

  if (node.cpuUsage > 70) reasons.push(`high CPU usage (${node.cpuUsage.toFixed(0)}%)`);
  if (node.ramUsage > 75) reasons.push(`high RAM pressure (${node.ramUsage.toFixed(0)}%)`);
  if (node.gpuUsage > 60) reasons.push(`active GPU workload (${node.gpuUsage.toFixed(0)}%)`);
  if (node.cpuTemp > 70 || node.gpuTemp > 75) reasons.push(`elevated temperatures (CPU ${node.cpuTemp.toFixed(0)}°C / GPU ${node.gpuTemp.toFixed(0)}°C)`);
  if (node.latencyMs > 50) reasons.push(`high network latency (${node.latencyMs.toFixed(0)}ms)`);
  if (node.runningTasks + node.waitingTasks > 3) reasons.push(`busy task queue (${node.runningTasks + node.waitingTasks} tasks)`);
  if (node.powerPluggedIn === false) reasons.push('running on battery power');
  if (node.diskUsage > 80) reasons.push(`low disk space (${node.diskUsage.toFixed(0)}% used)`);

  if (reasons.length === 0 && gap > 0) reasons.push(`lower overall availability score (${node.finalScore.toFixed(1)} vs ${winnerScore.toFixed(1)})`);

  return reasons.length > 0
    ? `Score ${node.finalScore.toFixed(1)}/100 — ${reasons.join(', ')}.`
    : `Marginally lower score (${node.finalScore.toFixed(1)} vs winner's ${winnerScore.toFixed(1)}).`;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Run the intelligent scheduler against a pool of devices.
 *
 * @param devices - Full device list
 * @param metricsMap - Latest SystemSnapshot per deviceId
 * @param poolDeviceIds - Optional: restrict to these device IDs (cluster pool)
 * @param weights - Scoring weights (defaults to DEFAULT_SCHEDULER_WEIGHTS)
 * @returns SchedulerDecision with winner and full explainability data
 */
export function runScheduler(
  devices: Device[],
  metricsMap: Record<string, SystemSnapshot>,
  poolDeviceIds?: string[],
  weights: SchedulerWeights = DEFAULT_SCHEDULER_WEIGHTS
): SchedulerDecision | null {
  const pool = poolDeviceIds
    ? devices.filter(d => poolDeviceIds.includes(d.deviceId))
    : devices;

  if (pool.length === 0) return null;

  const healthy: NodeScoreBreakdown[] = [];
  const eliminated: NodeScoreBreakdown[] = [];

  for (const device of pool) {
    const m = metricsMap[device.deviceId];
    const reason = eliminationReason(m, device.lastSeen);

    if (reason) {
      eliminated.push(buildNodeBreakdown(device, m, weights, true, reason));
    } else {
      healthy.push(buildNodeBreakdown(device, m, weights, false));
    }
  }

  if (healthy.length === 0) return null;

  // Sort by final score descending
  healthy.sort((a, b) => b.finalScore - a.finalScore);

  // Tiebreaker for nodes within 2 points of the leader
  const topScore = healthy[0].finalScore;
  const nearTied = healthy.filter(n => topScore - n.finalScore < 2);
  const { winner, method: tiebreakMethod } = applyTiebreaker(nearTied);
  const tiebroken = nearTied.length > 1;

  // Move winner to front of ranked list
  const rankedWithWinnerFirst = [
    winner,
    ...healthy.filter(n => n.deviceId !== winner.deviceId),
  ];

  const confidence = calculateConfidence(rankedWithWinnerFirst);
  const positiveFacts = buildPositiveFacts(winner, rankedWithWinnerFirst[1] ?? null);

  // Build rejection reasons for all non-winners
  rankedWithWinnerFirst.forEach((n, i) => {
    if (i > 0) {
      n.eliminationReason = buildRejectionReason(n, winner.finalScore);
    }
  });
  eliminated.forEach(n => {
    // eliminationReason already set during buildNodeBreakdown
  });

  // Build routing reason text
  const topTwoSummary = rankedWithWinnerFirst.length > 1
    ? ` Runner-up was ${rankedWithWinnerFirst[1].deviceName} (score ${rankedWithWinnerFirst[1].finalScore.toFixed(1)})`
    : '';

  const routingReason =
    `Node "${winner.deviceName}" was selected by the ClusterOS Intelligent Scheduler with an Overall Availability Score of ${winner.finalScore.toFixed(2)}/100. ` +
    `The score was computed from weighted metrics: CPU availability (${(weights.cpu * 100).toFixed(0)}%), ` +
    `RAM availability (${(weights.ram * 100).toFixed(0)}%), ` +
    `GPU availability (${(weights.gpu * 100).toFixed(0)}%), ` +
    `temperature safety (${(weights.temperature * 100).toFixed(0)}%), ` +
    `network quality (${(weights.network * 100).toFixed(0)}%), ` +
    `queue depth (${(weights.queue * 100).toFixed(0)}%), ` +
    `historical reliability (${(weights.reliability * 100).toFixed(0)}%), ` +
    `and disk health (${(weights.disk * 100).toFixed(0)}%).` +
    (tiebroken ? ` Tiebreaker applied: ${tiebreakMethod}.` : '') +
    topTwoSummary;

  // Estimated completion time (rough heuristic: lower score = longer queue wait)
  const expectedCompletionMinutes = Math.round(
    5 + (winner.runningTasks + winner.waitingTasks) * 2 + (100 - winner.finalScore) * 0.3
  );

  const decision: SchedulerDecision = {
    timestamp: Date.now(),
    selectedDeviceId: winner.deviceId,
    selectedDeviceName: winner.deviceName,
    finalScore: winner.finalScore,
    rank: 1,
    totalConsidered: healthy.length,
    confidence,
    routingReason,
    positiveFacts,
    tiebroken,
    weights,
    rankedNodes: rankedWithWinnerFirst,
    eliminatedNodes: eliminated,
    expectedCompletionMinutes,
  };

  if (tiebroken && tiebreakMethod) {
    decision.tiebreakMethod = tiebreakMethod;
  }

  return decision;
}

/**
 * Generate initial console log lines from a SchedulerDecision.
 * These are written to RTDB so the agent's live console shows the dispatch rationale.
 */
export function buildSchedulerConsoleLogs(decision: SchedulerDecision): string[] {
  const lines: string[] = [];
  lines.push(`[ClusterOS Scheduler] ═══════════════════════════════════════`);
  lines.push(`[ClusterOS Scheduler] Intelligent Workload Dispatch Engine v2.0`);
  lines.push(`[ClusterOS Scheduler] ═══════════════════════════════════════`);
  lines.push(`[ClusterOS Scheduler] Evaluating ${decision.totalConsidered + decision.eliminatedNodes.length} discovered nodes...`);
  if (decision.eliminatedNodes.length > 0) {
    lines.push(`[ClusterOS Scheduler] ⚠ ${decision.eliminatedNodes.length} node(s) eliminated after health check:`);
    decision.eliminatedNodes.forEach(n => {
      lines.push(`[ClusterOS Scheduler]   ✗ ${n.deviceName}: ${n.eliminationReason}`);
    });
  }
  lines.push(`[ClusterOS Scheduler] Scoring ${decision.totalConsidered} healthy node(s)...`);
  decision.rankedNodes.forEach((n, i) => {
    const flag = i === 0 ? ' ← SELECTED' : '';
    lines.push(`[ClusterOS Scheduler]   #${i + 1} ${n.deviceName.padEnd(20)} Score: ${n.finalScore.toFixed(2)}/100${flag}`);
  });
  lines.push(`[ClusterOS Scheduler] ───────────────────────────────────────`);
  lines.push(`[ClusterOS Scheduler] ✓ Selected: ${decision.selectedDeviceName}`);
  lines.push(`[ClusterOS Scheduler] ✓ Score: ${decision.finalScore.toFixed(2)}/100`);
  lines.push(`[ClusterOS Scheduler] ✓ Confidence: ${decision.confidence}%`);
  if (decision.tiebroken) {
    lines.push(`[ClusterOS Scheduler] ✓ Tiebreaker: ${decision.tiebreakMethod}`);
  }
  lines.push(`[ClusterOS Scheduler] Est. completion: ~${decision.expectedCompletionMinutes} min`);
  lines.push(`[ClusterOS Scheduler] Dispatching workload...`);
  lines.push(`[ClusterOS Scheduler] ═══════════════════════════════════════\n`);
  return lines;
}
