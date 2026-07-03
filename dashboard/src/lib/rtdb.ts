import { ref, onValue, set, get, push, remove, off, DatabaseReference, query, orderByKey, limitToLast } from 'firebase/database';
import { rtdb } from './firebase';
import type { SystemSnapshot, ProcessInfo, Command } from '@/types';

// ─── Metrics Subscriptions ────────────────────────────────────────────────────

export function subscribeDeviceMetrics(
  deviceId: string,
  callback: (snapshot: SystemSnapshot | null) => void
): () => void {
  const metricsRef = ref(rtdb, `devices/${deviceId}/metrics`);
  onValue(metricsRef, (snap) => {
    callback(snap.exists() ? snap.val() as SystemSnapshot : null);
  });
  return () => off(metricsRef);
}

export function subscribeDeviceProcesses(
  deviceId: string,
  callback: (processes: ProcessInfo[]) => void
): () => void {
  const processesRef = ref(rtdb, `devices/${deviceId}/processes`);
  onValue(processesRef, (snap) => {
    if (!snap.exists()) {
      callback([]);
      return;
    }
    const val = snap.val();
    const processes = Array.isArray(val) ? val : Object.values(val);
    callback(processes as ProcessInfo[]);
  });
  return () => off(processesRef);
}

export function subscribeMultipleDeviceMetrics(
  deviceIds: string[],
  callback: (metricsMap: Record<string, SystemSnapshot>) => void
): () => void {
  const unsubscribers: (() => void)[] = [];
  const metricsMap: Record<string, SystemSnapshot> = {};

  for (const deviceId of deviceIds) {
    const unsub = subscribeDeviceMetrics(deviceId, (snapshot) => {
      if (snapshot) {
        metricsMap[deviceId] = snapshot;
      } else {
        delete metricsMap[deviceId];
      }
      callback({ ...metricsMap });
    });
    unsubscribers.push(unsub);
  }

  return () => unsubscribers.forEach(fn => fn());
}

// ─── Command Dispatch (RTDB) ──────────────────────────────────────────────────

export async function dispatchCommandToDevice(
  deviceId: string,
  commandId: string,
  type: string,
  payload: Record<string, unknown>
): Promise<void> {
  const commandRef = ref(rtdb, `devices/${deviceId}/pendingCommands/${commandId}`);
  await set(commandRef, {
    type,
    payload,
    issuedAt: Date.now(),
  });
}

/**
 * Subscribe to a command result from the agent.
 * The agent writes to devices/{deviceId}/commandResults/{commandId} after execution.
 * Returns an unsubscribe function.
 */
export function subscribeCommandResult(
  deviceId: string,
  commandId: string,
  callback: (result: { status: string; output: string; completedAt: number } | null) => void
): () => void {
  const resultRef = ref(rtdb, `devices/${deviceId}/commandResults/${commandId}`);
  onValue(resultRef, (snap) => {
    callback(snap.exists() ? snap.val() : null);
  });
  return () => off(resultRef);
}

/**
 * One-shot: wait for a command result and resolve the promise when received.
 * Times out after timeoutMs and resolves with null.
 */
export function waitForCommandResult(
  deviceId: string,
  commandId: string,
  timeoutMs = 600_000
): Promise<{ status: string; output: string; completedAt: number } | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsub();
        resolve(null);
      }
    }, timeoutMs);

    const unsub = subscribeCommandResult(deviceId, commandId, (result) => {
      if (result && !resolved) {
        resolved = true;
        clearTimeout(timer);
        unsub();
        resolve(result);
      }
    });
  });
}

// ─── Live Job Output Streaming ────────────────────────────────────────────────

export interface OutputLine {
  idx: number;
  text: string;
  ts: number;
}

/**
 * Subscribe to real-time streaming output from a running job.
 * The agent pushes lines to devices/{deviceId}/jobOutput/{commandId}/{index}.
 * Callback receives the full ordered list of lines each time a new one arrives.
 */
export function subscribeJobOutput(
  deviceId: string,
  commandId: string,
  callback: (lines: OutputLine[]) => void
): () => void {
  const outputRef = ref(rtdb, `devices/${deviceId}/jobOutput/${commandId}`);
  onValue(outputRef, (snap) => {
    if (!snap.exists()) {
      callback([]);
      return;
    }
    const val = snap.val() as Record<string, { text: string; ts: number }>;
    const lines: OutputLine[] = Object.entries(val)
      .filter(([k, v]) => v !== null && v !== undefined)
      .map(([k, v]) => ({ idx: parseInt(k), text: v.text, ts: v.ts }))
      .sort((a, b) => a.idx - b.idx);
    callback(lines);
  });
  return () => off(outputRef);
}

/**
 * Clean up job output from RTDB after reading (optional, to save storage).
 */
export async function clearJobOutput(deviceId: string, commandId: string): Promise<void> {
  await remove(ref(rtdb, `devices/${deviceId}/jobOutput/${commandId}`));
}

export async function writeJobInitialLogs(
  deviceId: string,
  commandId: string,
  lines: string[]
): Promise<void> {
  const dbRef = ref(rtdb, `devices/${deviceId}/jobOutput/${commandId}`);
  const payload: Record<number, { text: string; ts: number }> = {};
  lines.forEach((text, i) => {
    payload[i] = { text, ts: Date.now() };
  });
  await set(dbRef, payload);
}

// ─── Pair Code Subscription ───────────────────────────────────────────────────

export function subscribePairCode(
  pairCode: string,
  callback: (data: Record<string, unknown> | null) => void
): () => void {
  const pairRef = ref(rtdb, `pairCodes/${pairCode}`);
  onValue(pairRef, (snap) => {
    callback(snap.exists() ? snap.val() : null);
  });
  return () => off(pairRef);
}

export async function consumePairCode(pairCode: string): Promise<{
  deviceId: string;
  machineName: string;
} | null> {
  const pairRef = ref(rtdb, `pairCodes/${pairCode}`);
  const snap = await get(pairRef);

  if (!snap.exists()) return null;

  const data = snap.val();
  if (data.status !== 'waiting') return null;

  // Delete pair code to make it single-use
  await remove(pairRef);

  return {
    deviceId: data.deviceId,
    machineName: data.machineName,
  };
}

// ─── Device Online Status ─────────────────────────────────────────────────────

export function subscribeDeviceOnlineStatus(
  deviceId: string,
  callback: (isOnline: boolean, lastSeen?: number) => void
): () => void {
  const statusRef = ref(rtdb, `devices/${deviceId}/metrics/status`);
  const lastSeenRef = ref(rtdb, `devices/${deviceId}/metrics/timestamp`);

  onValue(statusRef, (snap) => {
    const status = snap.val();
    get(lastSeenRef).then(ts => {
      callback(status === 'online', ts.val() || undefined);
    });
  });
  return () => off(statusRef);
}

// ─── RTDB Rental Helpers ──────────────────────────────────────────────────────

export interface ActiveRentalSessionRTDB {
  sessionId: string;
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
  mode: 'fixed' | 'pay_as_you_go';
  hourlyRate: number;
  durationHours: number;
  durationMinutes: number; // minutes-based duration
  startTime: number;
  elapsedSeconds: number;
  earnedBalance: number;
}

export async function startActiveRentalSessionRTDB(
  deviceId: string,
  session: ActiveRentalSessionRTDB
): Promise<void> {
  await set(ref(rtdb, `devices/${deviceId}/activeRentalSession`), session);
  await set(ref(rtdb, `rentals/${session.sessionId}`), session);
}

export function subscribeActiveRentalSessionRTDB(
  deviceId: string,
  callback: (session: ActiveRentalSessionRTDB | null) => void
): () => void {
  const rentalRef = ref(rtdb, `devices/${deviceId}/activeRentalSession`);
  onValue(rentalRef, (snap) => {
    callback(snap.exists() ? snap.val() as ActiveRentalSessionRTDB : null);
  });
  return () => off(rentalRef);
}

export async function stopActiveRentalSessionRTDB(
  deviceId: string,
  sessionId: string,
  finalStatus: 'completed' | 'cancelled' | 'failed'
): Promise<void> {
  const deviceSessionRef = ref(rtdb, `devices/${deviceId}/activeRentalSession`);
  const snap = await get(deviceSessionRef);
  if (snap.exists()) {
    const session = snap.val() as ActiveRentalSessionRTDB;
    session.status = finalStatus;
    // Update global rentals in RTDB
    await set(ref(rtdb, `rentals/${sessionId}`), session);
  }
  // Clear the active session from the device
  await remove(deviceSessionRef);
}

export function subscribeGlobalRentalSessionRTDB(
  sessionId: string,
  callback: (session: ActiveRentalSessionRTDB | null) => void
): () => void {
  const rentalRef = ref(rtdb, `rentals/${sessionId}`);
  onValue(rentalRef, (snap) => {
    callback(snap.exists() ? snap.val() as ActiveRentalSessionRTDB : null);
  });
  return () => off(rentalRef);
}
