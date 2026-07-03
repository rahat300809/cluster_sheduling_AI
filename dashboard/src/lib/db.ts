import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  query,
  where,
  or,
  orderBy,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  DocumentData,
} from 'firebase/firestore';
import { db, rtdb } from './firebase';
import { ref, set } from 'firebase/database';
import type { Device, Cluster, Job, Command, UserProfile, CommandType } from '@/types';

/** Firestore rejects undefined and NaN — strip/replace before writes. */
export function sanitizeForFirestore<T>(value: T): T {
  if (value === undefined) return value;
  if (value === null) return value;
  if (typeof value === 'number') {
    return (Number.isFinite(value) ? value : 0) as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitizeForFirestore(item)) as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val !== undefined) {
        out[key] = sanitizeForFirestore(val);
      }
    }
    return out as T;
  }
  return value;
}

// ─── User Helpers ─────────────────────────────────────────────────────────────

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  return { uid, ...snap.data() } as UserProfile;
}

export async function createUserProfile(uid: string, email: string): Promise<void> {
  await setDoc(doc(db, 'users', uid), {
    email,
    role: 'admin',
    createdAt: Date.now(),
  });
}

// ─── Device Helpers ───────────────────────────────────────────────────────────

export async function getDevices(ownerId: string): Promise<Device[]> {
  const qOwned = query(collection(db, 'devices'), where('ownerId', '==', ownerId));
  const qRented = query(collection(db, 'devices'), where('renterUserId', '==', ownerId));

  const [snapOwned, snapRented] = await Promise.all([
    getDocs(qOwned),
    getDocs(qRented)
  ]);

  const owned = snapOwned.docs.map(d => ({ id: d.id, ...d.data() } as Device));
  const rented = snapRented.docs.map(d => ({ id: d.id, ...d.data() } as Device));

  const merged = [...owned];
  rented.forEach(rd => {
    if (!merged.some(od => od.deviceId === rd.deviceId)) {
      merged.push(rd);
    }
  });

  return merged;
}

export function subscribeDevices(
  ownerId: string,
  callback: (devices: Device[]) => void
) {
  const qOwned = query(collection(db, 'devices'), where('ownerId', '==', ownerId));
  const qRented = query(collection(db, 'devices'), where('renterUserId', '==', ownerId));

  let ownedList: Device[] = [];
  let rentedList: Device[] = [];

  const updateMerged = () => {
    const merged = [...ownedList];
    rentedList.forEach(rd => {
      if (!merged.some(od => od.deviceId === rd.deviceId)) {
        merged.push(rd);
      }
    });
    callback(merged);
  };

  const unsubOwned = onSnapshot(qOwned, snap => {
    ownedList = snap.docs.map(d => ({ id: d.id, ...d.data() } as Device));
    updateMerged();
  });

  const unsubRented = onSnapshot(qRented, snap => {
    rentedList = snap.docs.map(d => ({ id: d.id, ...d.data() } as Device));
    updateMerged();
  });

  return () => {
    unsubOwned();
    unsubRented();
  };
}

export async function pairDevice(ownerId: string, pairCode: string): Promise<Device | null> {
  // Find device by pair code
  const q = query(
    collection(db, 'devices'),
    where('pairCode', '==', pairCode.toUpperCase()),
    where('paired', '==', false)
  );
  const snap = await getDocs(q);

  if (snap.empty) {
    throw new Error('Invalid or already used pair code');
  }

  const deviceDoc = snap.docs[0];
  const deviceId = deviceDoc.id;
  await updateDoc(deviceDoc.ref, {
    ownerId,
    paired: true,
    pairedAt: Date.now(),
  });

  // Set paired status in RTDB so host agent knows it is paired!
  await set(ref(rtdb, `devices/${deviceId}/paired`), true);

  return { id: deviceId, ...deviceDoc.data() } as Device;
}

export async function updateDeviceName(deviceId: string, name: string): Promise<void> {
  await updateDoc(doc(db, 'devices', deviceId), { name });
}

export async function deleteDevice(deviceId: string): Promise<void> {
  await deleteDoc(doc(db, 'devices', deviceId));
  await set(ref(rtdb, `devices/${deviceId}/paired`), false);
}

// ─── Cluster Helpers ──────────────────────────────────────────────────────────

export async function getClusters(ownerId: string): Promise<Cluster[]> {
  const q = query(collection(db, 'clusters'), where('ownerId', '==', ownerId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Cluster));
}

export function subscribeClusters(
  ownerId: string,
  callback: (clusters: Cluster[]) => void
) {
  const q = query(collection(db, 'clusters'), where('ownerId', '==', ownerId));
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as Cluster)));
  });
}

export async function createCluster(
  ownerId: string,
  name: string,
  description: string,
  color: string
): Promise<string> {
  const ref = await addDoc(collection(db, 'clusters'), {
    name,
    description,
    color,
    ownerId,
    deviceIds: [],
    createdAt: Date.now(),
  });
  return ref.id;
}

export async function addDeviceToCluster(clusterId: string, deviceId: string): Promise<void> {
  const clusterRef = doc(db, 'clusters', clusterId);
  const snap = await getDoc(clusterRef);
  if (!snap.exists()) return;

  const data = snap.data();
  const deviceIds = [...(data.deviceIds ?? [])];
  if (!deviceIds.includes(deviceId)) deviceIds.push(deviceId);

  await updateDoc(clusterRef, { deviceIds });
  await updateDoc(doc(db, 'devices', deviceId), { clusterId });
}

export async function removeDeviceFromCluster(clusterId: string, deviceId: string): Promise<void> {
  const clusterRef = doc(db, 'clusters', clusterId);
  const snap = await getDoc(clusterRef);
  if (!snap.exists()) return;

  const data = snap.data();
  const deviceIds = (data.deviceIds ?? []).filter((id: string) => id !== deviceId);
  await updateDoc(clusterRef, { deviceIds });
  await updateDoc(doc(db, 'devices', deviceId), { clusterId: null });
}

export async function deleteCluster(clusterId: string): Promise<void> {
  await deleteDoc(doc(db, 'clusters', clusterId));
}

// ─── Job Helpers ──────────────────────────────────────────────────────────────

export async function getJobs(ownerId: string, limit = 50): Promise<Job[]> {
  const q = query(
    collection(db, 'jobs'),
    where('ownerId', '==', ownerId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as Job))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export function subscribeJobs(ownerId: string, callback: (jobs: Job[]) => void) {
  const q = query(
    collection(db, 'jobs'),
    where('ownerId', '==', ownerId)
  );
  return onSnapshot(q, snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Job));
    list.sort((a, b) => b.createdAt - a.createdAt);
    callback(list);
  });
}

/**
 * Create a job document with a pre-generated ID.
 * Using setDoc so the document is immediately available for status updates.
 */
export async function createJob(job: Omit<Job, 'id'>): Promise<string> {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
  await setDoc(doc(db, 'jobs', jobId), sanitizeForFirestore(job));
  return jobId;
}

export async function updateJobStatus(jobId: string, status: Job['status'], output?: string): Promise<void> {
  const updates: Record<string, unknown> = { status };
  if (status === 'running') updates.startedAt = Date.now();
  if (status === 'completed' || status === 'failed') updates.completedAt = Date.now();
  if (output !== undefined) updates.output = output;
  await updateDoc(doc(db, 'jobs', jobId), updates);
}

// ─── Command Helpers ──────────────────────────────────────────────────────────

export async function getCommands(ownerId: string, limit = 50): Promise<Command[]> {
  const q = query(
    collection(db, 'commands'),
    where('issuedBy', '==', ownerId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as Command))
    .sort((a, b) => b.issuedAt - a.issuedAt)
    .slice(0, limit);
}

export function subscribeCommands(ownerId: string, callback: (commands: Command[]) => void) {
  const q = query(
    collection(db, 'commands'),
    where('issuedBy', '==', ownerId)
  );
  return onSnapshot(q, snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Command));
    list.sort((a, b) => b.issuedAt - a.issuedAt);
    callback(list);
  });
}

export async function createCommandRecord(
  commandId: string,
  deviceId: string,
  deviceName: string,
  type: string,
  payload: Record<string, unknown>,
  issuedBy: string
): Promise<void> {
  await setDoc(doc(db, 'commands', commandId), {
    deviceId,
    deviceName,
    type,
    payload,
    status: 'pending',
    issuedBy,
    issuedAt: Date.now(),
  });
}

export async function issueCommand(
  deviceId: string,
  deviceName: string,
  type: CommandType,
  payload: Record<string, unknown>,
  issuedBy: string
): Promise<string> {
  // Create command record in Firestore for history using a deterministic ID
  const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  await setDoc(doc(db, 'commands', commandId), {
    deviceId,
    deviceName,
    type,
    payload,
    status: 'pending',
    issuedBy,
    issuedAt: Date.now(),
  });

  return commandId;
}

/**
 * Update a command's status and output in Firestore.
 * Called by the dashboard when it receives a result from RTDB.
 */
export async function updateCommandStatus(
  commandId: string,
  status: 'success' | 'failed',
  output: string,
  completedAt: number
): Promise<void> {
  try {
    await updateDoc(doc(db, 'commands', commandId), {
      status,
      output,
      completedAt,
    });
  } catch {
    // Command doc might not exist (e.g. if agent command was dispatched without Firestore record)
  }
}

// ─── Rental Helpers ──────────────────────────────────────────────────────────

export interface RentalSessionData {
  id?: string;
  deviceId: string;
  deviceName: string;
  renterUserId: string;
  renterEmail: string;
  ownerUserId: string;
  hourlyRate: number;
  durationHours: number; // e.g. 1, 2 or -1 (pay-as-you-go)
  durationMinutes: number; // minutes-based duration
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
  mode: 'fixed' | 'pay_as_you_go';
  startTime: number;
  endTime: number;
  elapsedSeconds: number;
  earnedBalance: number;
  isViolated: boolean;
  createdAt: number;
}

export async function createRentalSessionFirestore(session: RentalSessionData): Promise<string> {
  const sessionId = session.id || doc(collection(db, 'rentals')).id;
  const sessionRef = doc(db, 'rentals', sessionId);
  await setDoc(sessionRef, { ...session, id: sessionId });
  return sessionId;
}

export async function updateRentalSessionFirestore(
  sessionId: string,
  updates: Partial<RentalSessionData>
): Promise<void> {
  await updateDoc(doc(db, 'rentals', sessionId), updates);
}

export function subscribeUserRentals(
  userId: string,
  role: 'owner' | 'renter',
  callback: (sessions: RentalSessionData[]) => void
) {
  const field = role === 'owner' ? 'ownerUserId' : 'renterUserId';
  const q = query(
    collection(db, 'rentals'),
    where(field, '==', userId)
  );
  return onSnapshot(q, snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as RentalSessionData));
    list.sort((a, b) => b.createdAt - a.createdAt);
    callback(list);
  });
}

export async function getUserBalance(uid: string): Promise<number> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return 0;
  return snap.data().balance ?? 0;
}

export async function addHostBalance(uid: string, amount: number): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return;
  const currentBalance = snap.data().balance ?? 0;
  await updateDoc(userRef, {
    balance: parseFloat((currentBalance + amount).toFixed(2))
  });
}
