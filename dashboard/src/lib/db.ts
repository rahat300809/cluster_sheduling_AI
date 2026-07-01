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
  orderBy,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Device, Cluster, Job, Command, UserProfile, CommandType } from '@/types';

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
  const q = query(collection(db, 'devices'), where('ownerId', '==', ownerId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Device));
}

export function subscribeDevices(
  ownerId: string,
  callback: (devices: Device[]) => void
) {
  const q = query(collection(db, 'devices'), where('ownerId', '==', ownerId));
  return onSnapshot(q, snap => {
    const devices = snap.docs.map(d => ({ id: d.id, ...d.data() } as Device));
    callback(devices);
  });
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
  await updateDoc(deviceDoc.ref, {
    ownerId,
    paired: true,
    pairedAt: Date.now(),
  });

  return { id: deviceDoc.id, ...deviceDoc.data() } as Device;
}

export async function updateDeviceName(deviceId: string, name: string): Promise<void> {
  await updateDoc(doc(db, 'devices', deviceId), { name });
}

export async function deleteDevice(deviceId: string): Promise<void> {
  await deleteDoc(doc(db, 'devices', deviceId));
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
  await setDoc(doc(db, 'jobs', jobId), job);
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
