'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false });
import { useAppStore } from '@/store/appStore';
import { createJob, updateJobStatus, updateCommandStatus, createCommandRecord, createNotebook, updateNotebook, subscribeNotebooks, deleteNotebook, subscribeJobs, deleteJob, updateJobArtifacts } from '@/lib/db';
import { dispatchCommandToDevice, subscribeCommandResult, subscribeJobOutput, subscribeJobArtifacts, updateJobArtifactsList } from '@/lib/rtdb';
import type { ArtifactEntry } from '@/lib/rtdb';
import { runScheduler, buildSchedulerConsoleLogs } from '@/lib/scheduler';
import { loadWeights } from '@/components/SchedulerWeightsPanel';
import { uploadDatasetFile, deleteDatasetFile, formatFileSize, getFileTypeCategory, deleteAllNotebookDatasets } from '@/lib/storage';
import type { StoredDatasetFile, DatasetUploadProgress } from '@/lib/storage';
import AiReportModal from '@/components/AiReportModal';
import { InlineAiAnalysis } from '@/components/InlineAiAnalysis';
import { Component as AiLoader } from '@/components/ui/ai-loader';
import { DEFAULT_SCHEDULER_WEIGHTS } from '@/types';
import {
  Play, Loader2, Terminal as TerminalIcon, Code,
  Monitor, ChevronRight, CheckCircle, XCircle,
  Clock, Plus, X, Network, Zap, Trash2, Download, AlertTriangle,
  Upload, FileText, Image, Archive, Box, File as FileIcon,
  FolderOpen, BookOpen, Save, Copy, MoreHorizontal,
  Database, Cpu, HardDrive, Activity, Sparkles, Layers,
  History, Trophy
} from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import type { Notebook, NotebookDatasetFile, SchedulerWeights, SchedulerDecision } from '@/types';
import type { DistributedTrainingSession, DistributedNodeStatus } from '@/types';
import { DistributedTrainingPanel } from './DistributedTrainingPanel';


// ─── File Type Icons ──────────────────────────────────────────────────────────

function FileTypeIcon({ category, className }: { category: string; className?: string }) {
  switch (category) {
    case 'data':    return <Database className={className} />;
    case 'image':   return <Image className={className} />;
    case 'archive': return <Archive className={className} />;
    case 'model':   return <Box className={className} />;
    case 'code':    return <Code className={className} />;
    default:        return <FileIcon className={className} />;
  }
}

// ─── Training Script Templates ────────────────────────────────────────────────

const TEMPLATES: Record<string, { label: string; code: string }> = {
  blank: {
    label: '📝 Blank Script',
    code: `# ClusterOS Notebook\n# Your uploaded datasets are available in DATASET_DIR\nimport os\n\nprint("Dataset directory:", DATASET_DIR)\nprint("Files:", os.listdir(DATASET_DIR))\n`,
  },
  sklearn: {
    label: '🔬 Scikit-Learn (CSV)',
    code: `import os
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report

# ─── Load your dataset ───────────────────────────
# DATASET_DIR is auto-injected by ClusterOS with your uploaded files
csv_files = [f for f in os.listdir(DATASET_DIR) if f.endswith('.csv')]
if not csv_files:
    print("ERROR: No CSV files found in DATASET_DIR")
    exit(1)

print(f"[ClusterOS] Loading dataset: {csv_files[0]}")
df = pd.read_csv(os.path.join(DATASET_DIR, csv_files[0]))
print(f"[ClusterOS] Dataset shape: {df.shape}")
print(f"[ClusterOS] Columns: {list(df.columns)}")

# ─── Prepare features & target ───────────────────
# Adjust these for your dataset
target_col = df.columns[-1]  # last column as target
X = df.drop(columns=[target_col])
X = X.select_dtypes(include=['number'])  # numeric features only
y = df[target_col]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
print(f"[ClusterOS] Train: {X_train.shape[0]} samples, Test: {X_test.shape[0]} samples")

# ─── Train Model ─────────────────────────────────
print("[ClusterOS] Training RandomForest classifier...")
model = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)
model.fit(X_train, y_train)

# ─── Evaluate ────────────────────────────────────
y_pred = model.predict(X_test)
acc = accuracy_score(y_test, y_pred)
print(f"\\n[ClusterOS] ✓ Training Complete!")
print(f"Accuracy: {acc:.4f}")
print(f"\\n{classification_report(y_test, y_pred)}")
`,
  },
  pytorch: {
    label: '🔥 PyTorch (Image Classification)',
    code: `import os
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
import numpy as np

print("[ClusterOS] PyTorch version:", torch.__version__)
print("[ClusterOS] CUDA available:", torch.cuda.is_available())
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f"[ClusterOS] Using device: {device}")

# ─── Load your data from DATASET_DIR ─────────────
print(f"[ClusterOS] Dataset directory: {DATASET_DIR}")
print(f"[ClusterOS] Files: {os.listdir(DATASET_DIR)}")

# Example: Generate synthetic data (replace with your real data loading)
X = torch.randn(1000, 784).to(device)
y = torch.randint(0, 10, (1000,)).to(device)

dataset = TensorDataset(X, y)
loader = DataLoader(dataset, batch_size=64, shuffle=True)

# ─── Define Model ────────────────────────────────
model = nn.Sequential(
    nn.Linear(784, 256),
    nn.ReLU(),
    nn.Dropout(0.3),
    nn.Linear(256, 128),
    nn.ReLU(),
    nn.Dropout(0.3),
    nn.Linear(128, 10)
).to(device)

criterion = nn.CrossEntropyLoss()
optimizer = optim.Adam(model.parameters(), lr=0.001)

# ─── Training Loop ───────────────────────────────
epochs = 10
for epoch in range(1, epochs + 1):
    model.train()
    total_loss = 0
    correct = 0
    total = 0
    
    for batch_X, batch_y in loader:
        optimizer.zero_grad()
        outputs = model(batch_X)
        loss = criterion(outputs, batch_y)
        loss.backward()
        optimizer.step()
        
        total_loss += loss.item()
        _, predicted = outputs.max(1)
        total += batch_y.size(0)
        correct += predicted.eq(batch_y).sum().item()
    
    acc = 100. * correct / total
    avg_loss = total_loss / len(loader)
    print(f"Epoch {epoch}/{epochs} - loss: {avg_loss:.4f} - accuracy: {acc:.2f}%")

print("[ClusterOS] ✓ Training Complete!")
`,
  },
  tensorflow: {
    label: '🧠 TensorFlow/Keras',
    code: `import os
import numpy as np
import tensorflow as tf
from tensorflow import keras

print("[ClusterOS] TensorFlow version:", tf.__version__)
print("[ClusterOS] GPU devices:", tf.config.list_physical_devices('GPU'))

# ─── Load your data from DATASET_DIR ─────────────
print(f"[ClusterOS] Dataset directory: {DATASET_DIR}")
print(f"[ClusterOS] Files: {os.listdir(DATASET_DIR)}")

# Example: MNIST-like synthetic data (replace with your real data)
X_train = np.random.randn(5000, 28, 28, 1).astype(np.float32)
y_train = np.random.randint(0, 10, (5000,))
X_test = np.random.randn(1000, 28, 28, 1).astype(np.float32)
y_test = np.random.randint(0, 10, (1000,))

print(f"[ClusterOS] Train: {X_train.shape[0]} samples")
print(f"[ClusterOS] Test: {X_test.shape[0]} samples")

# ─── Define Model ────────────────────────────────
model = keras.Sequential([
    keras.layers.Conv2D(32, 3, activation='relu', input_shape=(28, 28, 1)),
    keras.layers.MaxPooling2D(2),
    keras.layers.Conv2D(64, 3, activation='relu'),
    keras.layers.MaxPooling2D(2),
    keras.layers.Flatten(),
    keras.layers.Dense(128, activation='relu'),
    keras.layers.Dropout(0.5),
    keras.layers.Dense(10, activation='softmax'),
])

model.compile(
    optimizer='adam',
    loss='sparse_categorical_crossentropy',
    metrics=['accuracy']
)

model.summary()

# ─── Train ───────────────────────────────────────
print("\\n[ClusterOS] Starting training...")
model.fit(
    X_train, y_train,
    epochs=10,
    batch_size=64,
    validation_data=(X_test, y_test),
    verbose=1
)

loss, acc = model.evaluate(X_test, y_test, verbose=0)
print(f"\\n[ClusterOS] ✓ Training Complete!")
print(f"Test Accuracy: {acc:.4f}")
print(f"Test Loss: {loss:.4f}")
`,
  },
};

// ─── Status Badge Styles ──────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { bg: string; text: string; icon: typeof CheckCircle; spin?: boolean }> = {
  idle:       { bg: 'bg-slate-500/10 border-slate-500/20',   text: 'text-slate-400',  icon: Clock },
  uploading:  { bg: 'bg-cyan-500/10 border-cyan-500/20',     text: 'text-cyan-400',   icon: Upload },
  queued:     { bg: 'bg-amber-500/10 border-amber-500/20',   text: 'text-amber-400',  icon: Clock },
  installing: { bg: 'bg-cyan-500/10 border-cyan-500/20',     text: 'text-cyan-400',   icon: Loader2, spin: true },
  running:    { bg: 'bg-blue-500/10 border-blue-500/20',     text: 'text-blue-400',   icon: Loader2, spin: true },
  completed:  { bg: 'bg-green-500/10 border-green-500/20',   text: 'text-green-400',  icon: CheckCircle },
  failed:     { bg: 'bg-red-500/10 border-red-500/20',       text: 'text-red-400',    icon: XCircle },
};

// ─── Output Line Interface ────────────────────────────────────────────────────
interface OutputLine { idx: number; text: string; ts: number; }

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Main Notebook Page ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export default function NotebookPage() {
  const { user: authUser } = useAuth();
  const { devices, clusters, metricsMap, user, jobs } = useAppStore();
  const ownerId = user?.uid ?? authUser?.uid ?? null;
  const onlineDevices = devices.filter(d => metricsMap[d.deviceId]?.status === 'online');

  // All notebook-related jobs for the history section (same as Jobs page global view)
  const allHistoryJobs = jobs;

  // ─── Notebook state ───────────────────────────────────────────────────────
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(null);
  const [notebookName, setNotebookName] = useState('Untitled Notebook');
  const [code, setCode] = useState(TEMPLATES.blank.code);
  const [datasets, setDatasets] = useState<NotebookDatasetFile[]>([]);
  const [targetMode, setTargetMode] = useState<'cluster' | 'dedicated'>('cluster');
  const [targetClusterId, setTargetClusterId] = useState('');
  const [targetDeviceId, setTargetDeviceId] = useState('');
  const [forceWork, setForceWork] = useState(false);
  const [status, setStatus] = useState<string>('idle');
  const [isSaved, setIsSaved] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // ─── Distributed Training State ───────────────────────────────────────────
  const [distributedMode, setDistributedMode] = useState(false);
  const [distributedSession, setDistributedSession] = useState<DistributedTrainingSession | null>(null);
  const [isLaunchingDistributed, setIsLaunchingDistributed] = useState(false);
  const distributedUnsubsRef = useRef<(() => void)[]>([]);


  // Google Drive OAuth states
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(null);
  const [googleClientId, setGoogleClientId] = useState('775081867468-39avi6v8qj1j4cq6c6a1lsi7mjn1odeu.apps.googleusercontent.com');
  const [googleClient, setGoogleClient] = useState<any>(null);

  // History states
  const [historyJobs, setHistoryJobs] = useState<any[]>([]);
  const [terminalTab, setTerminalTab] = useState<'output' | 'history' | 'report' | 'artifacts'>('output');
  const [currentRunDecision, setCurrentRunDecision] = useState<SchedulerDecision | null>(null);

  // Subscribe to execution history jobs matching this notebook
  useEffect(() => {
    if (!ownerId || !activeNotebookId) {
      setHistoryJobs([]);
      return;
    }
    const unsub = subscribeJobs(ownerId, (allJobs) => {
      const filtered = allJobs.filter(j => j.notebookId === activeNotebookId);
      setHistoryJobs(filtered);
    });
    return () => unsub();
  }, [ownerId, activeNotebookId]);

  // Load Google Identity Services script
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);

    script.onload = () => {
      try {
        const client = (window as any).google?.accounts.oauth2.initTokenClient({
          client_id: googleClientId,
          scope: 'https://www.googleapis.com/auth/drive.file',
          callback: (response: any) => {
            if (response.access_token) {
              setGoogleAccessToken(response.access_token);
              localStorage.setItem('gdrive_token', response.access_token);
            }
          },
        });
        setGoogleClient(client);
      } catch (err) {
        console.error('Failed to init Google OAuth client:', err);
      }
    };

    if (typeof window !== 'undefined') {
      const savedToken = localStorage.getItem('gdrive_token');
      if (savedToken) setGoogleAccessToken(savedToken);
    }

    return () => {
      try {
        document.body.removeChild(script);
      } catch {}
    };
  }, [googleClientId]);

  const connectGoogleDrive = () => {
    if (googleClient) {
      googleClient.requestAccessToken();
    } else {
      alert('Google OAuth client is still loading. Please try again in a few seconds.');
    }
  };

  const disconnectGoogleDrive = () => {
    setGoogleAccessToken(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('gdrive_token');
    }
  };

  // External link / Google Drive dataset state
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');

  const handleLinkDataset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerId || !linkUrl.trim()) return;

    let filename = linkName.trim() || 'dataset.csv';
    // Auto-append .csv if no extension is provided
    if (filename !== 'dataset.csv' && !filename.includes('.')) {
      filename += '.csv';
    }

    const newDataset: NotebookDatasetFile = {
      name: filename,
      storagePath: `external/${Date.now()}`,
      downloadUrl: linkUrl.trim(),
      size: 0,
      type: 'external',
      uploadedAt: Date.now()
    };

    const updated = [...datasets.filter(d => d.name !== newDataset.name), newDataset];
    setDatasets(updated);
    setLinkUrl('');
    setLinkName('');

    if (!activeNotebookId) {
      const id = await createNotebook({
        name: notebookName,
        ownerId,
        code,
        datasets: updated,
        targetMode,
        targetClusterId,
        targetDeviceId,
        status: 'idle',
        forceWork,
        createdAt: Date.now(),
      });
      setActiveNotebookId(id);
    } else {
      await updateNotebook(activeNotebookId, { datasets: updated });
    }
  };

  // ─── Upload state ─────────────────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState<Record<string, DatasetUploadProgress>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Console state ────────────────────────────────────────────────────────
  const [consoleLines, setConsoleLines] = useState<OutputLine[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState('');
  const terminalScrollRef = useRef<HTMLDivElement>(null);
  const outputUnsubRef = useRef<(() => void) | null>(null);
  const commandUnsubsRef = useRef<(() => void)[]>([]);
  const artifactUnsubRef = useRef<(() => void) | null>(null);

  // ─── Artifact state ────────────────────────────────────────────────────
  const [artifacts, setArtifacts] = useState<ArtifactEntry[]>([]);

  // ─── AI report modal state ────────────────────────────────────────────────
  const [aiReportJob, setAiReportJob] = useState<{ aiReport: SchedulerDecision; name: string; id: string } | null>(null);

  // ─── Scheduler weights ────────────────────────────────────────────────────
  const schedulerWeights = loadWeights();

  // ─── Subscribe to saved notebooks ─────────────────────────────────────────
  useEffect(() => {
    if (!ownerId) return;
    const unsub = subscribeNotebooks(ownerId, (nbs) => setNotebooks(nbs));
    return () => unsub();
  }, [ownerId]);

  // ─── Auto-scroll terminal ────────────────────────────────────────────────
  useEffect(() => {
    if (terminalScrollRef.current) {
      terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight;
    }
  }, [consoleLines]);

  // ─── Console & Artifact subscription ─────────────────────────────────────
  useEffect(() => {
    if (outputUnsubRef.current) { outputUnsubRef.current(); outputUnsubRef.current = null; }
    if (artifactUnsubRef.current) { artifactUnsubRef.current(); artifactUnsubRef.current = null; }
    setConsoleLines([]);
    setArtifacts([]);

    if (activeJobId && activeDeviceId) {
      const cmdId = `job_${activeJobId}_${activeDeviceId}`;
      const unsub = subscribeJobOutput(activeDeviceId, cmdId, (lines) => setConsoleLines(lines));
      outputUnsubRef.current = unsub;

      const unsubArtifacts = subscribeJobArtifacts(activeDeviceId, cmdId, (newArtifacts) => {
        setArtifacts(newArtifacts);
      });
      artifactUnsubRef.current = unsubArtifacts;
    }
    return () => {
      if (outputUnsubRef.current) { outputUnsubRef.current(); outputUnsubRef.current = null; }
      if (artifactUnsubRef.current) { artifactUnsubRef.current(); artifactUnsubRef.current = null; }
    };
  }, [activeJobId, activeDeviceId]);

  // ─── Sync artifacts to Firestore job ───────────────────────────────────────
  useEffect(() => {
    if (activeJobId && artifacts.length > 0) {
      updateJobArtifacts(activeJobId, artifacts);
    }
  }, [activeJobId, artifacts]);

  // ─── Cleanup subscriptions on unmount ─────────────────────────────────────
  useEffect(() => () => {
    commandUnsubsRef.current.forEach(fn => fn());
    if (artifactUnsubRef.current) { artifactUnsubRef.current(); artifactUnsubRef.current = null; }
  }, []);

  // ─── Load notebook into editor ────────────────────────────────────────────
  const loadNotebook = (nb: Notebook) => {
    setActiveNotebookId(nb.id);
    setNotebookName(nb.name);
    setCode(nb.code);
    setDatasets(nb.datasets ?? []);
    setTargetMode(nb.targetMode);
    setTargetClusterId(nb.targetClusterId ?? '');
    setTargetDeviceId(nb.targetDeviceId ?? '');
    setForceWork(nb.forceWork);
    setStatus(nb.status);
    setIsSaved(true);
    setCurrentRunDecision(nb.aiReport || null);
    if (nb.lastJobId) {
      setActiveJobId(nb.lastJobId);
      const devId = nb.targetDeviceId || '';
      setActiveDeviceId(devId);
    }
  };

  // ─── Create new notebook ──────────────────────────────────────────────────
  const newNotebook = () => {
    setActiveNotebookId(null);
    setNotebookName('Untitled Notebook');
    setCode(TEMPLATES.blank.code);
    setDatasets([]);
    setTargetMode('cluster');
    setTargetClusterId('');
    setTargetDeviceId('');
    setForceWork(false);
    setStatus('idle');
    setIsSaved(false);
    setConsoleLines([]);
    setActiveJobId(null);
    setActiveDeviceId('');
    setCurrentRunDecision(null);
  };

  // ─── Save notebook ────────────────────────────────────────────────────────
  const saveNotebook = async () => {
    if (!ownerId) return;
    const nbData = {
      name: notebookName,
      ownerId,
      code,
      datasets,
      targetMode,
      targetClusterId,
      targetDeviceId,
      status: status as Notebook['status'],
      forceWork,
      createdAt: Date.now(),
    };
    if (activeNotebookId) {
      await updateNotebook(activeNotebookId, nbData);
    } else {
      const id = await createNotebook(nbData);
      setActiveNotebookId(id);
    }
    setIsSaved(true);
  };

  // ─── Delete notebook ──────────────────────────────────────────────────────
  const deleteFileFromGoogleDrive = async (fileId: string, token: string) => {
    try {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        console.warn('Failed to delete file from Google Drive:', await response.text());
      }
    } catch (err) {
      console.warn('Google Drive delete error:', err);
    }
  };

  const handleDeleteNotebook = async (nbId: string) => {
    if (!confirm('Are you sure you want to delete this notebook and all its datasets?')) return;
    if (!ownerId) {
      alert('Cannot delete: You must be logged in.');
      return;
    }
    try {
      const nb = notebooks.find(n => n.id === nbId);
      if (nb && nb.datasets && nb.datasets.length > 0) {
        for (const d of nb.datasets) {
          try {
            if (d.type === 'gdrive' && d.storagePath) {
              const fileId = d.storagePath.split('/').pop();
              if (fileId) {
                await deleteFileFromGoogleDrive(fileId, d.accessToken || googleAccessToken || '');
              }
            }
          } catch (gdriveErr) {
            console.warn('Google Drive file deletion skipped:', gdriveErr);
          }
        }
      }
    } catch (err) {
      console.warn('Notebook Drive clean up skipped:', err);
    }

    try {
      await deleteAllNotebookDatasets(ownerId, nbId);
    } catch (err) {
      console.warn('Firebase Storage cleanup skipped:', err);
    }

    try {
      await deleteNotebook(nbId);
      if (activeNotebookId === nbId) newNotebook();
    } catch (err) {
      console.error('Delete notebook record failed:', err);
      alert(`Failed to delete notebook: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // ─── Save / Delete Artifact Helpers ────────────────────────────────────────

  const handleSaveArtifactToDatasets = async (art: ArtifactEntry) => {
    if (!ownerId || !activeNotebookId) return;
    const newDataset = {
      name: art.name,
      storagePath: art.storagePath,
      downloadUrl: art.downloadUrl,
      size: art.size,
      type: 'firebase' as const,
      uploadedAt: Date.now()
    };
    // Prevent duplicates
    const updated = [...datasets.filter(d => d.storagePath !== art.storagePath), newDataset];
    setDatasets(updated);
    await updateNotebook(activeNotebookId, { datasets: updated });
    alert(`✓ Saved '${art.name}' to datasets list successfully!`);
  };

  const handleDeleteArtifact = async (art: ArtifactEntry) => {
    if (!confirm(`Are you sure you want to delete the artifact '${art.name}'?`)) return;
    try {
      // 1. Delete from Firebase Storage
      try {
        await deleteDatasetFile(art.storagePath);
      } catch (err) {
        console.warn('Firebase Storage deletion skipped or failed:', err);
      }
      // 2. Update RTDB list
      const updated = artifacts.filter(a => a.storagePath !== art.storagePath);
      const cmdId = `job_${activeJobId}_${activeDeviceId}`;
      if (activeDeviceId) {
        await updateJobArtifactsList(activeDeviceId, cmdId, updated);
      }
      setArtifacts(updated);
    } catch (err) {
      console.error('Delete artifact failed:', err);
    }
  };

  const handleDownloadArtifact = (art: ArtifactEntry) => {
    if (art.base64) {
      try {
        const binStr = atob(art.base64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }
        const ext = art.name.split('.').pop()?.toLowerCase() || '';
        let mimeType = 'application/octet-stream';
        if (ext === 'json') mimeType = 'application/json';
        else if (ext === 'csv') mimeType = 'text/csv';
        else if (ext === 'txt' || ext === 'log') mimeType = 'text/plain';
        else if (ext === 'png') mimeType = 'image/png';
        else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';

        const blob = new Blob([bytes], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = art.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Failed to decode base64 artifact:', err);
        alert('Failed to download artifact: Data corruption.');
      }
    } else {
      window.open(art.downloadUrl, '_blank', 'noopener,noreferrer');
    }
  };


  // ─── Google Drive Upload Helper ───────────────────────────────────────────
  const makeGoogleDriveFilePublic = async (fileId: string, token: string) => {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone'
      })
    });
    if (!response.ok) {
      console.warn('Failed to make Google Drive file public:', await response.text());
    }
  };

  const uploadToGoogleDrive = async (
    file: File,
    token: string,
    onProgress?: (percent: number) => void
  ): Promise<NotebookDatasetFile> => {
    const metadata = {
      name: file.name,
      mimeType: file.type || 'application/octet-stream'
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent);
        }
      };

      xhr.onload = async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.response);
            
            // Auto make public link so target agent can access it easily
            try {
              await makeGoogleDriveFilePublic(data.id, token);
            } catch (err) {
              console.warn('Could not auto-make file public:', err);
            }

            resolve({
              name: file.name,
              storagePath: `gdrive/${data.id}`,
              downloadUrl: `https://drive.google.com/uc?export=download&id=${data.id}`,
              accessToken: token, // pass the download token to the agent as fallback
              size: file.size,
              type: 'gdrive',
              uploadedAt: Date.now()
            });
          } catch (err) {
            reject(err);
          }
        } else {
          reject(new Error(`Google Drive upload failed with status ${xhr.status}: ${xhr.statusText}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during Google Drive upload'));
      xhr.send(form);
    });
  };

  // ─── File Upload ──────────────────────────────────────────────────────────
  const handleFilesSelected = async (files: FileList | File[]) => {
    if (!ownerId) return;
    let currentNbId = activeNotebookId;
    if (!currentNbId) {
      currentNbId = await createNotebook({
        name: notebookName,
        ownerId,
        code,
        datasets: [],
        targetMode,
        targetClusterId,
        targetDeviceId,
        status: 'idle',
        forceWork,
        createdAt: Date.now(),
      });
      setActiveNotebookId(currentNbId);
    }
    const finalNbId = currentNbId;

    for (const rawFile of Array.from(files)) {
      // Keep original filenames — users may upload multiple CSVs (train.csv, test.csv)
      let file = rawFile;
      try {
        let stored: NotebookDatasetFile;

        if (googleAccessToken) {
          // Upload directly to Google Drive
          setUploading(prev => ({
            ...prev,
            [file.name]: {
              bytesTransferred: 0,
              totalBytes: file.size,
              percent: 0,
              state: 'running'
            }
          }));

          stored = await uploadToGoogleDrive(file, googleAccessToken, (percent) => {
            setUploading(prev => ({
              ...prev,
              [file.name]: {
                bytesTransferred: Math.round((percent / 100) * file.size),
                totalBytes: file.size,
                percent,
                state: 'running'
              }
            }));
          });
        } else {
          // Fallback to Firebase Storage
          const { promise } = uploadDatasetFile(ownerId, finalNbId, file, (progress) => {
            setUploading(prev => ({ ...prev, [file.name]: progress }));
          });
          stored = await promise;
        }

        setDatasets(prev => {
          const updated = [...prev.filter(d => d.name !== stored.name), stored];
          // Also update in Firestore
          if (finalNbId) {
            updateNotebook(finalNbId, { datasets: updated });
          }
          return updated;
        });
        
        setUploading(prev => {
          const next = { ...prev };
          delete next[file.name];
          return next;
        });
      } catch (err) {
        console.error('Upload failed:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('401') || errMsg.toLowerCase().includes('unauthorized')) {
          setGoogleAccessToken(null);
          localStorage.removeItem('gdrive_token');
          alert('Your Google Drive session has expired. We have cleared it.\n\nPlease click "Connect Google Drive" to authenticate again and retry your upload.');
        } else {
          alert(`Upload failed: ${errMsg}\n\nIf Firebase Storage is not set up, click "Connect Google Drive" below to upload via Google Drive!`);
        }
        setUploading(prev => {
          const next = { ...prev };
          delete next[file.name];
          return next;
        });
      }
    }
  };

  const handleDeleteDataset = async (dataset: NotebookDatasetFile) => {
    try {
      if (dataset.type === 'gdrive') {
        const fileId = dataset.storagePath.split('/').pop();
        if (fileId && (dataset.accessToken || googleAccessToken)) {
          await deleteFileFromGoogleDrive(fileId, dataset.accessToken || googleAccessToken || '');
        }
      } else if (dataset.type !== 'external') {
        try {
          await deleteDatasetFile(dataset.storagePath);
        } catch (storageErr) {
          console.warn('Firebase Storage delete skipped:', storageErr);
        }
      }
    } catch (err) {
      console.warn('Delete backend file failed:', err);
    }

    setDatasets(prev => {
      const updated = prev.filter(d => d.storagePath !== dataset.storagePath);
      if (activeNotebookId) updateNotebook(activeNotebookId, { datasets: updated });
      return updated;
    });
  };

  // ─── Drag & Drop handlers ────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleFilesSelected(e.dataTransfer.files);
  };

  // ─── Run Notebook ─────────────────────────────────────────────────────────
  const handleRun = async () => {
    if (!ownerId) {
      alert('You must be signed in. Please refresh and log in again.');
      return;
    }
    if (status === 'running' || status === 'installing') return;

    if (targetMode === 'dedicated' && !targetDeviceId) {
      alert('Please select a target device.');
      return;
    }

    // Auto-save before running
    await saveNotebook();

    setIsAnalyzing(true);
    commandUnsubsRef.current.forEach(fn => fn());
    commandUnsubsRef.current = [];

    try {
      let targetDeviceIds: string[] = [];
      let label = '';
      let schedulerDecision: SchedulerDecision | null = null;

      if (targetMode === 'dedicated') {
        targetDeviceIds = [targetDeviceId];
        const d = devices.find(x => x.deviceId === targetDeviceId);
        label = d?.name || d?.machineName || targetDeviceId;
        schedulerDecision = runScheduler(devices, metricsMap, undefined, schedulerWeights, code);
      } else {
        const cluster = clusters.find(c => c.id === targetClusterId);
        const poolIds = cluster?.deviceIds?.length ? cluster.deviceIds : undefined;
        schedulerDecision = runScheduler(devices, metricsMap, poolIds, schedulerWeights, code);
        if (!schedulerDecision) {
          alert('No healthy nodes found. Ensure the agent is running and nodes are online.');
          setIsAnalyzing(false);
          return;
        }
        targetDeviceIds = [schedulerDecision.selectedDeviceId];
        label = `${schedulerDecision.selectedDeviceName} (auto — score ${schedulerDecision.finalScore.toFixed(1)})`;
      }

      if (targetDeviceIds.length === 0) {
        alert('No online target devices found.');
        setIsAnalyzing(false);
        return;
      }

      setStatus('queued');

      // Build dataset payload for the agent
      const datasetPayload = datasets.map(d => ({
        name: d.name,
        downloadUrl: d.downloadUrl,
        accessToken: d.accessToken || googleAccessToken || undefined,
      }));

      const primaryDeviceId = targetDeviceIds[0];
      const jobId = await createJob({
        name: notebookName,
        type: 'python',
        script: code,
        targetDeviceIds,
        status: 'queued',
        ownerId,
        createdAt: Date.now(),
        priority: 1,
        forceWork,
        aiReport: schedulerDecision ?? undefined,
        notebookId: activeNotebookId ?? undefined,
      });

      if (activeNotebookId) {
        await updateNotebook(activeNotebookId, {
          lastJobId: jobId,
          lastRunAt: Date.now(),
          status: 'queued',
          aiReport: schedulerDecision ?? undefined,
        });
      }

      const cmdId = `job_${jobId}_${primaryDeviceId}`;
      const dev = devices.find(x => x.deviceId === primaryDeviceId);
      const devName = dev?.name || dev?.machineName || primaryDeviceId;

      if (ownerId) {
        await createCommandRecord(cmdId, primaryDeviceId, devName, 'run_script', {
          script: code,
          forceWork,
          datasets: datasetPayload,
        }, ownerId);
      }

      await dispatchCommandToDevice(primaryDeviceId, cmdId, 'run_script', {
        script: code,
        forceWork,
        datasets: datasetPayload,
      });
      await updateJobStatus(jobId, 'running');

      setActiveJobId(jobId);
      setActiveDeviceId(primaryDeviceId);
      setConsoleLines([]);
      setStatus('running');
      if (schedulerDecision) {
        setCurrentRunDecision(schedulerDecision);
        setTerminalTab('report');
      }

      // Subscribe to command result
      const timeoutTimer = setTimeout(async () => {
        unsubResult();
        await updateJobStatus(jobId, 'failed', 'Timed out after 10 minutes.');
        setStatus('failed');
        if (activeNotebookId) await updateNotebook(activeNotebookId, { status: 'failed' });
      }, 600_000);

      const unsubResult = subscribeCommandResult(primaryDeviceId, cmdId, async (result) => {
        if (!result) return;
        if (result.status === 'installing') { setStatus('installing'); }
        else if (result.status === 'running') { setStatus('running'); }
        else if (result.status === 'success' || result.status === 'failed') {
          clearTimeout(timeoutTimer);
          unsubResult();
          const ok = result.status === 'success';
          await updateCommandStatus(cmdId, ok ? 'success' : 'failed', result.output ?? '', result.completedAt ?? Date.now());
          await updateJobStatus(jobId, ok ? 'completed' : 'failed', result.output ?? '');
          setStatus(ok ? 'completed' : 'failed');
          if (activeNotebookId) await updateNotebook(activeNotebookId, { status: ok ? 'completed' : 'failed', lastOutput: result.output });
        }
      });

      commandUnsubsRef.current.push(unsubResult);
    } catch (err) {
      console.error('Notebook run failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to run notebook.');
      setStatus('failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ─── Distributed Training Handler ─────────────────────────────────────────
  const handleDistributedRun = async (selectedDeviceIds: string[]) => {
    if (!ownerId || selectedDeviceIds.length === 0) return;
    setIsLaunchingDistributed(true);

    // Cleanup previous distributed subs
    distributedUnsubsRef.current.forEach(fn => fn());
    distributedUnsubsRef.current = [];

    // Auto-save first
    await saveNotebook();

    const totalShards = selectedDeviceIds.length;
    const sessionId = `dist_${Date.now()}`;
    const datasetPayload = datasets.map(d => ({
      name: d.name,
      downloadUrl: d.downloadUrl,
      accessToken: d.accessToken || googleAccessToken || undefined,
    }));

    // Initialize session state
    const initialNodeStatuses: DistributedNodeStatus[] = selectedDeviceIds.map((devId, idx) => {
      const d = devices.find(x => x.deviceId === devId);
      return {
        deviceId: devId,
        deviceName: d?.name || d?.machineName || devId,
        jobId: '',
        shardIndex: idx,
        status: 'pending',
        progress: 0,
      };
    });

    const newSession: DistributedTrainingSession = {
      id: sessionId,
      notebookId: activeNotebookId || '',
      notebookName: notebookName,
      ownerId,
      deviceIds: selectedDeviceIds,
      totalShards,
      jobIds: [],
      status: 'launching',
      nodeStatuses: initialNodeStatuses,
      createdAt: Date.now(),
      launchedAt: Date.now(),
      strategy: 'data_parallel',
    };

    setDistributedSession(newSession);

    try {
      const jobIds: string[] = [];
      const updatedNodeStatuses: DistributedNodeStatus[] = [...initialNodeStatuses];

      // Dispatch one job per device in parallel
      const dispatchPromises = selectedDeviceIds.map(async (devId, shardIndex) => {
        const d = devices.find(x => x.deviceId === devId);
        const devName = d?.name || d?.machineName || devId;

        // Inject shard environment variables as Python preamble
        const shardPreamble = [
          `# ═══ ClusterOS Distributed Training — Shard ${shardIndex + 1} of ${totalShards} ═══`,
          `SHARD_INDEX = ${shardIndex}`,
          `TOTAL_SHARDS = ${totalShards}`,
          `DISTRIBUTED_SESSION_ID = "${sessionId}"`,
          `NODE_NAME = "${devName}"`,
          ``,
          `# Your dataset shard: load only your slice using SHARD_INDEX / TOTAL_SHARDS`,
          `# Example: df.iloc[len(df)*SHARD_INDEX//TOTAL_SHARDS : len(df)*(SHARD_INDEX+1)//TOTAL_SHARDS]`,
          ``,
        ].join('\n');

        const shardedCode = shardPreamble + code;

        // Create Firestore job
        const jobId = await createJob({
          name: `${notebookName} [Shard ${shardIndex + 1}/${totalShards}]`,
          type: 'python',
          script: shardedCode,
          targetDeviceIds: [devId],
          status: 'queued',
          ownerId,
          createdAt: Date.now(),
          priority: 1,
          forceWork,
          notebookId: activeNotebookId ?? undefined,
          isDistributed: true,
          distributedSessionId: sessionId,
          shardIndex,
          totalShards,
        });

        jobIds.push(jobId);
        // Update node status using shard index directly (safe — index access, not push)
        updatedNodeStatuses[shardIndex] = {
          ...updatedNodeStatuses[shardIndex],
          jobId,
          status: 'running',
        };

        const cmdId = `job_${jobId}_${devId}`;
        if (ownerId) {
          await createCommandRecord(cmdId, devId, devName, 'run_script', {
            script: shardedCode,
            forceWork,
            datasets: datasetPayload,
          }, ownerId);
        }

        await dispatchCommandToDevice(devId, cmdId, 'run_script', {
          script: shardedCode,
          forceWork,
          datasets: datasetPayload,
        });
        // NOTE: Do NOT call updateJobStatus('running') here — the agent drives the status
        // lifecycle (queued → installing → running → completed/failed) via subscribeCommandResult.

        // Subscribe to per-node output
        const outputUnsub = subscribeJobOutput(devId, cmdId, (lines) => {
          if (lines.length > 0) {
            const lastLine = lines[lines.length - 1]?.text || '';
            const progress = lines.reduce((best, l) => {
              const p = parseProgress(l.text);
              return p > best ? p : best;
            }, 0);
            setDistributedSession(prev => {
              if (!prev) return prev;
              const updated = prev.nodeStatuses.map(n =>
                n.deviceId === devId ? { ...n, lastLine, progress } : n
              );
              return { ...prev, nodeStatuses: updated };
            });
          }
        });
        distributedUnsubsRef.current.push(outputUnsub);

        // Subscribe to command result for this node
        const resultUnsub = subscribeCommandResult(devId, cmdId, async (result) => {
          if (!result) return;
          if (result.status === 'success' || result.status === 'failed') {
            const ok = result.status === 'success';
            await updateCommandStatus(cmdId, ok ? 'success' : 'failed', result.output ?? '', result.completedAt ?? Date.now());
            await updateJobStatus(jobId, ok ? 'completed' : 'failed', result.output ?? '');

            if (ok) {
              const artUnsub = subscribeJobArtifacts(devId, cmdId, (newArtifacts) => {
                setDistributedSession(prev => {
                  if (!prev) return prev;
                  const updated = prev.nodeStatuses.map(n =>
                    n.deviceId === devId ? { ...n, artifacts: newArtifacts } : n
                  );
                  return { ...prev, nodeStatuses: updated };
                });
              });
              distributedUnsubsRef.current.push(artUnsub);
            }

            setDistributedSession(prev => {
              if (!prev) return prev;
              const nodeStatus: DistributedNodeStatus['status'] = ok ? 'completed' : 'failed';
              const updated: DistributedNodeStatus[] = prev.nodeStatuses.map(n =>
                n.deviceId === devId
                  ? { ...n, status: nodeStatus, progress: ok ? 100 : n.progress, completedAt: Date.now() }
                  : n
              );

              // Recalculate session status
              const allDone = updated.every(n => n.status === 'completed' || n.status === 'failed');
              const anyFailed = updated.some(n => n.status === 'failed');
              const allCompleted = updated.every(n => n.status === 'completed');
              const sessionStatus: DistributedTrainingSession['status'] = allDone
                ? (allCompleted ? 'completed' : anyFailed ? 'partial' : 'failed')
                : 'running';

              return { ...prev, nodeStatuses: updated, status: sessionStatus };
            });
          }
        });
        distributedUnsubsRef.current.push(resultUnsub);

        // Return jobId with shardIndex so Promise.all can collect in defined order
        return jobId;
      });

      // Promise.all preserves input order — no race condition on the jobIds array
      const orderedJobIds = await Promise.all(dispatchPromises);

      setDistributedSession(prev => prev ? {
        ...prev,
        status: 'running',
        jobIds: orderedJobIds,
        nodeStatuses: updatedNodeStatuses,
      } : prev);

    } catch (err) {
      console.error('Distributed training launch failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to launch distributed training.');
      setDistributedSession(prev => prev ? { ...prev, status: 'failed' } : prev);
    } finally {
      setIsLaunchingDistributed(false);
    }
  };

  // Helper to parse progress from output text
  function parseProgress(text: string): number {
    const epochMatch = text.match(/Epoch\s+(\d+)\/(\d+)/i);
    if (epochMatch) return Math.round((parseInt(epochMatch[1]) / parseInt(epochMatch[2])) * 100);
    const stepMatch = text.match(/Step\s+(\d+)\/(\d+)/i);
    if (stepMatch) return Math.round((parseInt(stepMatch[1]) / parseInt(stepMatch[2])) * 100);
    const pctMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pctMatch) return Math.min(100, parseFloat(pctMatch[1]));
    return 0;
  }

  // ─── Render helpers ───────────────────────────────────────────────────────
  const currentStatusStyle = STATUS_STYLE[status] ?? STATUS_STYLE.idle;
  const StatusIcon = currentStatusStyle.icon;
  const isRunning = status === 'running' || status === 'installing' || status === 'queued';

  // Target device info for the environment bar
  const targetDevice = targetMode === 'dedicated'
    ? devices.find(d => d.deviceId === targetDeviceId)
    : null;
  const targetMetrics = targetDevice ? metricsMap[targetDevice.deviceId] : null;

  return (
    <div className="space-y-4">
      {/* AI Report Modal */}
      <AnimatePresence>
        {aiReportJob?.aiReport && (
          <AiReportModal
            decision={aiReportJob.aiReport}
            jobName={aiReportJob.name}
            jobId={aiReportJob.id}
            onClose={() => setAiReportJob(null)}
          />
        )}
      </AnimatePresence>

      {/* AI Loading Animation */}
      <AnimatePresence>
        {isAnalyzing && <AiLoader text="ANALYZING" />}
      </AnimatePresence>

      {/* ═══ Header ═══ */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center animate-pulse-glow"
            style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}
          >
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold gradient-text">Notebook</h1>
            <p className="text-xs font-medium text-muted">Google Colab-style training — runs on your own cluster PCs</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full border ${currentStatusStyle.bg} ${currentStatusStyle.text}`}>
            <StatusIcon className={`w-3 h-3 ${currentStatusStyle.spin ? 'animate-spin' : ''}`} />
            {status.toUpperCase()}
          </span>
          <span
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8', boxShadow: '0 4px 16px rgba(0,0,0,0.30)' }}
          >
            <span className="w-2 h-2 rounded-full animate-online" style={{ background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
            {onlineDevices.length} nodes ready
          </span>
        </div>
      </div>

      {/* ═══ Notebook Selector Bar ═══ */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
        <button
          onClick={newNotebook}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap btn-glass"
          style={{ color: '#a78bfa', border: '1px solid rgba(139,92,246,0.20)', background: 'rgba(139,92,246,0.08)' }}
        >
          <Plus className="w-3.5 h-3.5" /> New Notebook
        </button>
        {notebooks.slice(0, 8).map(nb => (
          <div
            key={nb.id}
            onClick={() => loadNotebook(nb)}
            className={`group flex items-center gap-2.5 px-3.5 py-2 rounded-lg border cursor-pointer text-xs font-semibold whitespace-nowrap transition-all select-none`}
            style={nb.id === activeNotebookId ? {
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(139,92,246,0.35)',
              color: '#a78bfa',
              boxShadow: '0 4px 16px rgba(139,92,246,0.15)',
            } : {
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              color: '#64748b',
            }}
          >
            <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate max-w-[120px] text-bright">{nb.name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteNotebook(nb.id);
              }}
              className={`p-1 rounded transition-all flex items-center justify-center ml-0.5 z-10 ${
                nb.id === activeNotebookId ? 'opacity-85 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:opacity-100'
              }`}
              style={{ color: '#f43f5e' }}
              title="Delete notebook"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {/* ═══ Main IDE Layout ═══ */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">

        {/* ─── Left: Code Editor (8 cols) ────────────────────────────── */}
        <div className="xl:col-span-8 flex flex-col gap-3">
          {/* Toolbar */}
          <div className="glass-card px-4 py-3 flex flex-col gap-3">
            {/* Row 1: Name + Save + Run + Distributed Toggle */}
            <div className="flex items-center justify-between gap-3">
              <input
                type="text"
                value={notebookName}
                onChange={e => { setNotebookName(e.target.value); setIsSaved(false); }}
                className="bg-transparent border-none outline-none font-bold text-sm flex-1 rounded px-1"
                style={{ color: '#1e1b4b' }}
                placeholder="Notebook name..."
              />
              <div className="flex items-center gap-2">
                {/* Template selector */}
                <select
                  onChange={e => { setCode(TEMPLATES[e.target.value]?.code ?? code); setIsSaved(false); }}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] focus:outline-none appearance-none cursor-pointer input-glass"
                  defaultValue=""
                  style={{ color: '#4b5563' }}
                >
                  <option value="" disabled>📋 Templates</option>
                  {Object.entries(TEMPLATES).map(([key, t]) => (
                    <option key={key} value={key}>{t.label}</option>
                  ))}
                </select>
                <button
                  onClick={saveNotebook}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all`}
                  style={isSaved ? {
                    background: 'rgba(156,163,175,0.10)',
                    border: '1px solid rgba(156,163,175,0.20)',
                    color: '#9ca3af',
                  } : {
                    background: 'rgba(99,102,241,0.10)',
                    border: '1px solid rgba(99,102,241,0.22)',
                    color: '#6366f1',
                  }}
                >
                  <Save className="w-3.5 h-3.5" />
                  {isSaved ? 'Saved' : 'Save'}
                </button>
                {activeNotebookId && notebooks.find(n => n.id === activeNotebookId)?.aiReport && (
                  <button
                    onClick={() => {
                      const nb = notebooks.find(n => n.id === activeNotebookId);
                      if (nb?.aiReport) {
                        setAiReportJob({
                          aiReport: nb.aiReport,
                          name: notebookName,
                          id: activeNotebookId
                        });
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap btn-glass"
                    style={{ color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.22)', background: 'rgba(139,92,246,0.08)' }}
                  >
                    ✨ AI Report
                  </button>
                )}
                <div
                  onClick={() => setForceWork(!forceWork)}
                  className="flex items-center gap-2 cursor-pointer text-xs font-semibold transition-colors select-none"
                  style={{ color: forceWork ? '#ef4444' : '#9ca3af' }}
                >
                  <div className={`w-8 h-4 rounded-full relative transition-colors`} style={{ background: forceWork ? '#ef4444' : 'rgba(156,163,175,0.25)', border: `1px solid ${forceWork ? 'rgba(239,68,68,0.4)' : 'rgba(156,163,175,0.3)'}` }}>
                    <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${forceWork ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Force
                </div>

                {/* Distributed Mode Toggle */}
                <button
                  onClick={() => setDistributedMode(d => !d)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={distributedMode ? {
                    background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.12))',
                    border: '1px solid rgba(99,102,241,0.35)',
                    color: '#4f46e5',
                    boxShadow: '0 2px 8px rgba(99,102,241,0.15)',
                  } : {
                    background: 'rgba(255,255,255,0.70)',
                    border: '1px solid rgba(255,255,255,0.85)',
                    color: '#6b7280',
                  }}
                  title={distributedMode ? 'Switch to single-node mode' : 'Enable multi-GPU distributed training'}
                >
                  <Layers className="w-3.5 h-3.5" />
                  {distributedMode ? 'Multi-GPU ON' : 'Multi-GPU'}
                </button>

                {!distributedMode && (
                  <button
                    onClick={handleRun}
                    disabled={isRunning || onlineDevices.length === 0}
                    className="flex items-center gap-2 px-5 py-1.5 font-bold rounded-lg text-xs transition-all uppercase tracking-wide"
                    style={isRunning || onlineDevices.length === 0 ? {
                      background: 'rgba(156,163,175,0.20)',
                      color: '#9ca3af',
                      cursor: 'not-allowed',
                    } : {
                      background: 'linear-gradient(135deg, #10b981, #059669)',
                      color: 'white',
                      boxShadow: '0 4px 12px rgba(16,185,129,0.30)',
                    }}
                  >
                    {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" style={{ fill: 'currentColor' }} />}
                    {isRunning ? 'Running...' : 'Run'}
                  </button>
                )}
              </div>
            </div>

            {/* Row 2: Target Mode */}
            {!distributedMode && (
            <div className="flex items-center gap-3 flex-wrap">
              <div
                className="flex items-center gap-1 rounded-xl p-1"
                style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.12)' }}
              >
                <button
                  onClick={() => setTargetMode('cluster')}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                  style={targetMode === 'cluster' ? {
                    background: 'rgba(99,102,241,0.12)',
                    color: '#4f46e5',
                    border: '1px solid rgba(99,102,241,0.22)',
                  } : {
                    color: '#9ca3af',
                    border: '1px solid transparent',
                  }}
                >
                  <Network className="w-3.5 h-3.5" /> Cluster (Auto)
                </button>
                <button
                  onClick={() => setTargetMode('dedicated')}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                  style={targetMode === 'dedicated' ? {
                    background: 'rgba(16,185,129,0.10)',
                    color: '#059669',
                    border: '1px solid rgba(16,185,129,0.22)',
                  } : {
                    color: '#9ca3af',
                    border: '1px solid transparent',
                  }}
                >
                  <Monitor className="w-3.5 h-3.5" /> Dedicated PC
                </button>
              </div>

              {targetMode === 'cluster' && (
                <select
                  value={targetClusterId}
                  onChange={e => setTargetClusterId(e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-xs focus:outline-none appearance-none input-glass"
                  style={{ color: '#1e1b4b' }}
                >
                  <option value="">All Devices (Best Node)</option>
                  {clusters.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({(c.deviceIds ?? []).length} devices)</option>
                  ))}
                </select>
              )}

              {targetMode === 'dedicated' && (
                <select
                  value={targetDeviceId}
                  onChange={e => setTargetDeviceId(e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-xs focus:outline-none appearance-none input-glass"
                  style={{ color: '#1e1b4b' }}
                >
                  <option value="">Select PC...</option>
                  {onlineDevices.map(d => {
                    const cpu = metricsMap[d.deviceId]?.cpu?.total ?? 0;
                    return <option key={d.deviceId} value={d.deviceId}>{d.name || d.machineName} — CPU: {Number(cpu).toFixed(0)}%</option>;
                  })}
                </select>
              )}

              {/* Target device live stats */}
              {targetMetrics && (
                <div className="flex items-center gap-3 text-[10px] font-semibold" style={{ color: '#6b7280' }}>
                  <span className="flex items-center gap-1" style={{ color: '#6366f1' }}><Cpu className="w-3 h-3" /> CPU: {targetMetrics.cpu?.total?.toFixed(0)}%</span>
                  <span className="flex items-center gap-1" style={{ color: '#8b5cf6' }}><HardDrive className="w-3 h-3" /> RAM: {targetMetrics.ram?.usedPercent?.toFixed(0)}%</span>
                  {targetMetrics.gpu?.usagePercent > 0 && (
                    <span className="flex items-center gap-1" style={{ color: '#f59e0b' }}><Activity className="w-3 h-3" /> GPU: {targetMetrics.gpu.usagePercent?.toFixed(0)}%</span>
                  )}
                </div>
              )}
            </div>
            )}
          </div>

          {/* Monaco Editor */}
          <div className="glass-card overflow-hidden flex flex-col" style={{ height: 420 }}>
            <Editor
              height="100%"
              defaultLanguage="python"
              value={code}
              onChange={v => { setCode(v ?? ''); setIsSaved(false); }}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineHeight: 20,
                fontFamily: 'Fira Code, JetBrains Mono, Consolas, monospace',
                automaticLayout: true,
                padding: { top: 12 },
              }}
            />
          </div>

          {/* ─── Live Terminal Output / History Tabs ─────────────────────────── */}
          <div className="glass-card border border-slate-800 bg-[#050814] flex flex-col overflow-hidden" style={{ height: 280 }}>
            {/* Tabs Header */}
            <div className="bg-slate-950/80 px-4 py-2 border-b border-slate-800/80 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setTerminalTab('output')}
                  className={`text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5 transition-all ${
                    terminalTab === 'output' ? 'text-green-400 font-bold border-b border-green-400 pb-1' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <TerminalIcon className="w-3.5 h-3.5" />
                  Live Output
                  {isRunning && <Loader2 className="w-3 h-3 animate-spin text-blue-400 ml-1" />}
                </button>
                {(activeNotebookId && notebooks.find(n => n.id === activeNotebookId)?.aiReport) || currentRunDecision ? (
                  <button
                    onClick={() => setTerminalTab('report')}
                    className={`text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5 transition-all ${
                      terminalTab === 'report' ? 'text-violet-400 font-bold border-b border-violet-400 pb-1' : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    AI Analysis
                  </button>
                ) : null}
                <button
                  onClick={() => setTerminalTab('history')}
                  className={`text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5 transition-all ${
                    terminalTab === 'history' ? 'text-violet-400 font-bold border-b border-violet-400 pb-1' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  Execution History ({historyJobs.length})
                </button>
                <button
                  onClick={() => setTerminalTab('artifacts')}
                  className={`text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5 transition-all ${
                    terminalTab === 'artifacts' ? 'text-amber-400 font-bold border-b border-amber-400 pb-1' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Box className="w-3.5 h-3.5" />
                  Output Artifacts ({artifacts.length})
                  {artifacts.length > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse ml-0.5" />
                  )}
                </button>
              </div>
              {terminalTab === 'output' && consoleLines.length > 0 && (
                <button
                  onClick={() => {
                    const content = consoleLines.map(l => l.text).join('\n');
                    const blob = new Blob([content], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `notebook_output_${Date.now()}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[9px] font-semibold transition-all"
                >
                  <Download className="w-2.5 h-2.5" /> Download
                </button>
              )}
            </div>

            {/* Scrollable Container */}
            <div ref={terminalScrollRef} className="flex-1 p-4 overflow-y-auto font-mono text-xs space-y-0.5 select-text scrollbar-thin">
              {terminalTab === 'report' ? (
                <div className="font-sans">
                  {(() => {
                    const nb = notebooks.find(n => n.id === activeNotebookId);
                    const decision = nb?.aiReport ?? currentRunDecision;
                    return decision ? (
                      <InlineAiAnalysis decision={decision} />
                    ) : (
                      <div className="text-center text-slate-500 py-8">No AI Analysis report found.</div>
                    );
                  })()}
                </div>
              ) : terminalTab === 'output' ? (
                consoleLines.length === 0 ? (
                  activeJobId ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center py-8">
                      <Loader2 className="w-8 h-8 text-green-400 animate-spin mb-3" />
                      <p className="font-semibold text-green-400 tracking-wide text-xs">DISPATCHING WORKLOAD</p>
                      <p className="text-[10px] text-slate-500 mt-1">Waiting for agent to initialize execution...</p>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 text-center py-8">
                      <TerminalIcon className="w-8 h-8 mb-2 opacity-20" />
                      <p>Console Idle</p>
                      <p className="text-[10px] opacity-60 mt-1">Press Run to execute your notebook on the target PC</p>
                    </div>
                  )
                ) : (
                  consoleLines
                    .filter(line => {
                      const t = line.text.trim();
                      if (!t) return false;
                      if (t.startsWith('Requirement already satisfied') || t.startsWith('[pip] Requirement')) return false;
                      if (t.startsWith('[pip] Downloading') || (t.startsWith('Downloading') && (t.endsWith('.whl') || t.endsWith('.gz') || t.includes('/packages/')))) return false;
                      if (t.startsWith('Using cached') || t.startsWith('[pip] Using cached')) return false;
                      if (t.startsWith('Obtaining') || t.startsWith('[pip] Obtaining')) return false;
                      if (t.includes('━━') || t.includes('───')) return false;
                      if (t.includes('kB/s') || t.includes('MB/s')) return false;
                      if (t.startsWith('Notice:')) return false;
                      return true;
                    })
                    .map(line => {
                      const t = line.text.trim();
                      let cls = 'text-slate-200';
                      let prefix = '';
                      if (t.startsWith('[ClusterOS Scheduler]')) cls = 'text-violet-300 font-semibold';
                      else if (t.startsWith('[ClusterOS]')) cls = 'text-green-400 font-semibold';
                      else if (t.startsWith('[pip]')) cls = 'text-cyan-400/80';
                      else if (t.startsWith('ERROR:') || t.includes('WARNING') || t.startsWith('Traceback') || t.includes('Error:')) cls = 'text-red-400 font-semibold';
                      else if (t.startsWith('Successfully installed')) cls = 'text-emerald-400';
                      else { cls = 'text-slate-100'; prefix = '› '; }
                      return (
                        <div key={line.idx} className={`leading-5 whitespace-pre-wrap ${cls}`}>
                          {prefix}{line.text}
                        </div>
                      );
                    })
                )
              ) : terminalTab === 'artifacts' ? (
                <div className="space-y-2 font-sans">
                  {artifacts.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 text-center py-8">
                      <Box className="w-8 h-8 mb-2 opacity-20" />
                      <p className="text-xs">No artifacts generated yet</p>
                      <p className="text-[10px] opacity-60 mt-0.5">Trained model files (.pkl, .pt, .h5, etc.) and CSV outputs will appear here when ready</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {artifacts.map((art, idx) => {
                        const ext = art.name.split('.').pop() || '';
                        let typeCategory = 'other';
                        if (['pkl', 'h5', 'pt', 'pth', 'onnx', 'joblib', 'safetensors', 'model', 'weights'].includes(ext.toLowerCase())) typeCategory = 'model';
                        else if (['csv', 'json', 'jsonl', 'txt', 'log'].includes(ext.toLowerCase())) typeCategory = 'data';
                        else if (['png', 'jpg', 'jpeg', 'svg'].includes(ext.toLowerCase())) typeCategory = 'image';

                        return (
                          <div key={idx} className="flex items-center justify-between p-3 bg-slate-900/60 border border-slate-800 rounded-lg hover:border-slate-700 transition-all">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-400">
                                <FileTypeIcon category={typeCategory} className="w-4 h-4 text-violet-400" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-white truncate max-w-[200px]" title={art.name}>{art.name}</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">{formatFileSize(art.size)}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <button
                                onClick={() => handleSaveArtifactToDatasets(art)}
                                className="p-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-400 rounded transition-all flex items-center justify-center"
                                title="Save to Datasets list"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                               <button
                                 onClick={() => handleDownloadArtifact(art)}
                                 className="p-1.5 bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 rounded transition-all flex items-center justify-center"
                                 title="Download artifact"
                               >
                                 <Download className="w-3.5 h-3.5" />
                               </button>
                              <button
                                onClick={() => handleDeleteArtifact(art)}
                                className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded transition-all flex items-center justify-center"
                                title="Delete artifact"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2 font-sans">
                  {historyJobs.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 text-center py-8">
                      <Clock className="w-8 h-8 mb-2 opacity-20" />
                      <p className="text-xs">No execution history</p>
                      <p className="text-[10px] opacity-60 mt-0.5">Run this notebook to see past training history here</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs text-slate-300">
                        <thead>
                          <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase font-semibold">
                            <th className="py-2">Run Date</th>
                            <th className="py-2">PC / Node</th>
                            <th className="py-2">Status</th>
                            <th className="py-2">AI Conf.</th>
                            <th className="py-2 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-900">
                          {historyJobs.map(job => {
                            const dateStr = format(new Date(job.createdAt), 'MMM dd, HH:mm:ss');
                            const nodeName = job.targetDeviceIds?.[0] || 'Unknown';
                            const d = devices.find(x => x.deviceId === nodeName);
                            const devName = d?.name || d?.machineName || nodeName;

                            let statusCls = 'text-slate-400 bg-slate-500/10 border-slate-500/20';
                            if (job.status === 'completed') statusCls = 'text-green-400 bg-green-500/10 border-green-500/20';
                            else if (job.status === 'failed') statusCls = 'text-red-400 bg-red-500/10 border-red-500/20';
                            else if (job.status === 'running') statusCls = 'text-blue-400 bg-blue-500/10 border-blue-500/20 animate-pulse';

                            return (
                              <tr key={job.id} className="hover:bg-slate-900/30 transition-colors">
                                <td className="py-2 font-mono text-[11px] text-slate-400">{dateStr}</td>
                                <td className="py-2 font-semibold text-slate-300">{devName}</td>
                                <td className="py-2">
                                  <span className={`px-2 py-0.5 rounded-full border text-[9px] font-bold ${statusCls}`}>
                                    {job.status.toUpperCase()}
                                  </span>
                                </td>
                                <td className="py-2 font-mono text-slate-400">
                                  {job.aiReport ? `${(job.aiReport.confidence * 100).toFixed(0)}%` : '—'}
                                </td>
                                <td className="py-2 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    {job.artifacts && job.artifacts.length > 0 && (
                                      <button
                                        onClick={() => {
                                          setActiveJobId(job.id);
                                          setActiveDeviceId(job.targetDeviceIds?.[0] || '');
                                          setTerminalTab('artifacts');
                                        }}
                                        className="text-amber-400 hover:text-amber-350 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 transition-all flex items-center gap-1"
                                        title="View output model / data files"
                                      >
                                        <Box className="w-2.5 h-2.5" />
                                        Files ({job.artifacts.length})
                                      </button>
                                    )}
                                    <button
                                      onClick={() => {
                                        setActiveJobId(job.id);
                                        setActiveDeviceId(job.targetDeviceIds?.[0] || '');
                                        setTerminalTab('output');
                                      }}
                                      className="text-slate-400 hover:text-white text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800 border border-slate-700 transition-all"
                                    >
                                      Logs
                                    </button>
                                    <button
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        if (confirm('Delete this history entry?')) {
                                          await deleteJob(job.id);
                                        }
                                      }}
                                      className="text-slate-600 hover:text-red-400 p-1"
                                      title="Delete run entry"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ─── Right: Dataset + Distributed Panel (4 cols) ─────────────── */}
        <div className="xl:col-span-4 flex flex-col gap-3">

          {/* Distributed Training Panel — shown when multi-GPU mode active */}
          {distributedMode && (
            <div className="glass-card p-4">
              <DistributedTrainingPanel
                devices={devices}
                metricsMap={metricsMap}
                onLaunch={handleDistributedRun}
                session={distributedSession}
                isLaunching={isLaunchingDistributed}
                notebookName={notebookName}
              />
            </div>
          )}

          {/* Google Drive Connection Settings */}
          <div className="glass-card border border-slate-800 p-4 rounded-xl flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-violet-400" />
                Google Drive Automation
              </span>
              {googleAccessToken ? (
                <span className="text-[9px] font-bold text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">
                  Connected
                </span>
              ) : (
                <span className="text-[9px] font-bold text-slate-400 bg-slate-900/60 border border-slate-800 px-2 py-0.5 rounded-full">
                  Disconnected
                </span>
              )}
            </div>

            {googleAccessToken ? (
              <div className="space-y-2">
                <p className="text-[10px] text-slate-400">
                  🎉 Google Drive is connected. Dropping files in the uploader below will now upload them directly to Google Drive.
                </p>
                <button
                  onClick={disconnectGoogleDrive}
                  className="w-full py-1.5 border border-red-500/20 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold rounded-lg text-xs transition-all"
                >
                  Disconnect Google Account
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] text-slate-400">
                  Connect your Google Account to automatically upload datasets to Google Drive and download them to the target PC.
                </p>
                <button
                  onClick={connectGoogleDrive}
                  className="w-full py-1.5 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 shadow-md"
                >
                  🔑 Connect Google Drive
                </button>
              </div>
            )}

            {/* Custom Client ID Setup */}
            <div className="border-t border-slate-900 pt-2 space-y-2">
              <details className="group">
                <summary className="text-[9px] text-slate-500 hover:text-slate-300 cursor-pointer select-none outline-none list-none flex items-center justify-between">
                  <span>⚙️ OAuth Configuration</span>
                  <span className="transition-transform group-open:rotate-180">▼</span>
                </summary>
                <div className="mt-2 space-y-2">
                  <div className="space-y-1">
                    <label className="text-[9px] text-slate-500">Google OAuth Client ID</label>
                    <input
                      type="text"
                      value={googleClientId}
                      onChange={e => {
                        setGoogleClientId(e.target.value);
                        localStorage.setItem('gdrive_client_id', e.target.value);
                      }}
                      placeholder="Enter Client ID..."
                      className="w-full px-2 py-1 bg-slate-950 border border-slate-800 rounded text-[10px] text-white focus:outline-none focus:border-violet-500/40"
                    />
                  </div>
                  <p className="text-[8px] text-slate-600 leading-normal">
                    * Make sure your Client ID has Authorized Javascript Origins set to your hosting URL: https://cluster300809.web.app
                  </p>
                </div>
              </details>
            </div>
          </div>

          {/* Dataset Upload Zone */}
          <div
            className={`glass-card border-2 border-dashed rounded-xl p-6 transition-all cursor-pointer relative ${
              isDragging
                ? 'border-violet-400 bg-violet-500/5'
                : 'border-slate-700 hover:border-slate-600 hover:bg-slate-900/40'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={e => e.target.files && handleFilesSelected(e.target.files)}
            />
            <div className="flex flex-col items-center text-center gap-2">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                isDragging ? 'bg-violet-500/20' : 'bg-slate-800'
              }`}>
                <Upload className={`w-6 h-6 ${isDragging ? 'text-violet-400' : 'text-slate-500'}`} />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Upload Dataset</p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Drag & drop files here or click to browse
                </p>
                <p className="text-[10px] text-slate-600 mt-0.5">
                  CSV, images, ZIP, H5, Parquet — up to 500 MB
                </p>
              </div>
            </div>

            {/* Upload progress indicators */}
            {Object.entries(uploading).length > 0 && (
              <div className="mt-4 space-y-2">
                {Object.entries(uploading).map(([name, progress]) => (
                  <div key={name} className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 truncate flex-1">{name}</span>
                    <div className="w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-500 rounded-full transition-all duration-300"
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-violet-400 font-mono w-8 text-right">{progress.percent}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* External / Google Drive Link Form */}
          <div className="glass-card border border-slate-800 p-4 rounded-xl flex flex-col gap-2.5">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
              <Database className="w-3.5 h-3.5 text-violet-400" />
              Link Large Dataset (e.g. Google Drive)
            </div>
            <form onSubmit={handleLinkDataset} className="space-y-2">
              <input
                type="text"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                placeholder="Paste Google Drive link or download URL..."
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/40"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={linkName}
                  onChange={e => setLinkName(e.target.value)}
                  placeholder="Filename (e.g. dataset.csv)"
                  className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/40"
                />
                <button
                  type="submit"
                  disabled={!linkUrl.trim()}
                  className="px-4 py-1.5 bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-all whitespace-nowrap"
                >
                  Add Dataset
                </button>
              </div>
            </form>
          </div>

          {/* Dataset File List */}
          <div className="glass-card border border-slate-800 flex flex-col overflow-hidden" style={{ minHeight: 200 }}>
            <div className="bg-slate-950/60 px-4 py-2.5 border-b border-slate-800/80 flex items-center justify-between flex-shrink-0">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-violet-400" />
                Datasets ({datasets.length})
              </span>
              {datasets.length > 0 && (
                <span className="text-[10px] text-slate-600">
                  {formatFileSize(datasets.reduce((sum, d) => sum + d.size, 0))} total
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {datasets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-600">
                  <Database className="w-6 h-6 mb-2 opacity-30" />
                  <p className="text-xs">No datasets uploaded</p>
                  <p className="text-[10px] opacity-60 mt-0.5">Upload files to make them available on the target PC</p>
                </div>
              ) : (
                datasets.map(dataset => {
                  const category = getFileTypeCategory(dataset.name);
                  return (
                    <motion.div
                      key={dataset.storagePath}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800/60 hover:border-slate-700 transition-all group"
                    >
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        category === 'data' ? 'bg-blue-500/10 text-blue-400' :
                        category === 'image' ? 'bg-pink-500/10 text-pink-400' :
                        category === 'archive' ? 'bg-amber-500/10 text-amber-400' :
                        category === 'model' ? 'bg-violet-500/10 text-violet-400' :
                        category === 'code' ? 'bg-green-500/10 text-green-400' :
                        'bg-slate-800 text-slate-400'
                      }`}>
                        <FileTypeIcon category={category} className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white truncate font-medium">{dataset.name}</p>
                        <p className="text-[10px] text-slate-500">{formatFileSize(dataset.size)}</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteDataset(dataset); }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/10 rounded text-slate-500 hover:text-red-400 transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </motion.div>
                  );
                })
              )}
            </div>
          </div>

          {/* DATASET_DIR hint */}
          {datasets.length > 0 && (
            <div className="glass-card border border-slate-800 p-3">
              <p className="text-[10px] text-slate-500 font-semibold mb-1.5 uppercase tracking-wider">📁 Access your files in Python</p>
              <div className="bg-slate-950 rounded-lg px-3 py-2 font-mono text-[11px] text-green-400 border border-slate-800">
                <div className="text-slate-500"># Auto-injected by ClusterOS</div>
                <div>DATASET_DIR = <span className="text-amber-300">"/tmp/clusteros_datasets/..."</span></div>
                <div className="mt-1">
                  <span className="text-slate-500"># Example:</span>
                </div>
                <div>
                  <span className="text-blue-400">import</span> pandas <span className="text-blue-400">as</span> pd
                </div>
                <div>
                  df = pd.read_csv(f<span className="text-amber-300">"{'{'}DATASET_DIR{'}'}/{datasets[0]?.name}"</span>)
                </div>
              </div>
            </div>
          )}

          {/* Quick Info */}
          <div className="glass-card border border-slate-800 p-3 space-y-2">
            <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">How it works</p>
            <div className="space-y-1.5">
              {[
                { icon: Upload, text: 'Upload datasets → stored in Firebase Storage', color: 'text-violet-400' },
                { icon: Play, text: 'Click Run → scheduler picks best PC', color: 'text-green-400' },
                { icon: Download, text: 'Agent downloads datasets to target PC', color: 'text-blue-400' },
                { icon: TerminalIcon, text: 'Training runs live — output streams here', color: 'text-amber-400' },
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] text-slate-400">
                  <step.icon className={`w-3 h-3 ${step.color} flex-shrink-0`} />
                  <span>{step.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Workload History ───────────────────────────────── */}
      <div className="glass-card p-5 border border-slate-800/80">
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <History className="w-4 h-4 text-violet-400" />
          Workload History
          {activeNotebookId && (
            <span className="text-[10px] text-slate-600 font-normal ml-1">
              ({notebookName})
            </span>
          )}
          <span className="ml-auto text-xs text-slate-500">{allHistoryJobs.filter(j => j.type === 'python').length} total</span>
        </h2>

        {allHistoryJobs.filter(j => j.type === 'python').length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-20" />
            <p>No notebook workloads dispatched yet</p>
            <p className="text-xs text-slate-600 mt-1">Click Run to start your first execution</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {[...allHistoryJobs]
              .filter(j => j.type === 'python')
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, 16)
              .map(job => {
                const style = STATUS_STYLE[job.status] ?? STATUS_STYLE.idle;
                const HistoryStatusIcon = style.icon;
                const isActiveJob = activeJobId === job.id;
                const deviceId = (job.targetDeviceIds ?? [])[0];
                const targetNode = devices.find(d => d.deviceId === deviceId);
                const nodeName = (job.targetDeviceIds?.length ?? 0) > 1
                  ? `${job.targetDeviceIds!.length} nodes (distributed)`
                  : (targetNode?.name || targetNode?.machineName || 'Unknown');
                const isDistributed = job.isDistributed || (job.targetDeviceIds?.length ?? 0) > 1;

                return (
                  <motion.div
                    key={job.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => {
                      setCode(job.script);
                      setNotebookName(job.name.replace(/ \[Shard \d+\/\d+\]$/, ''));
                      setForceWork(job.forceWork ?? false);
                      setActiveJobId(job.id);
                      setActiveDeviceId(job.targetDeviceIds?.[0] || '');
                      setTerminalTab('output');
                    }}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-2.5 ${
                      isActiveJob
                        ? 'bg-slate-900 border-violet-500/30 shadow-[0_0_12px_rgba(139,92,246,0.08)]'
                        : 'bg-slate-950/40 border-slate-900 hover:bg-slate-900/40 hover:border-slate-800'
                    }`}
                  >
                    {/* Title row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-white truncate">{job.name}</p>
                        <p className="text-[10px] text-slate-500">
                          {format(new Date(job.createdAt), 'MMM d, HH:mm')}
                        </p>
                      </div>
                      <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ${style.bg} ${style.text}`}>
                        <HistoryStatusIcon className={`w-3 h-3 ${style.spin ? 'animate-spin' : ''}`} />
                        {job.status}
                      </span>
                    </div>

                    {/* Score badge + distributed badge */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {job.aiReport && (
                        <>
                          <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-violet-400 font-semibold">
                            <Trophy className="w-2.5 h-2.5" />
                            Score {Number(job.aiReport.finalScore ?? 0).toFixed(1)}
                          </span>
                          <span className="text-[9px] text-slate-600">Conf: {job.aiReport.confidence}%</span>
                        </>
                      )}
                      {isDistributed && (
                        <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-semibold">
                          <Layers className="w-2.5 h-2.5" />
                          Distributed
                        </span>
                      )}
                    </div>

                    {/* Footer row */}
                    <div className="flex items-center justify-between text-xs border-t border-slate-900 pt-2 text-slate-500">
                      <span className="flex items-center gap-1.5 truncate min-w-0">
                        <Cpu className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{nodeName}</span>
                      </span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {job.aiReport && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              setAiReportJob({ aiReport: job.aiReport!, name: job.name, id: job.id });
                            }}
                            className="flex items-center gap-0.5 text-[9px] text-violet-400 hover:text-violet-300 transition-colors"
                          >
                            <Activity className="w-2.5 h-2.5" /> Report
                          </button>
                        )}
                        {job.artifacts && job.artifacts.length > 0 && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              setActiveJobId(job.id);
                              setActiveDeviceId(job.targetDeviceIds?.[0] || '');
                              setTerminalTab('artifacts');
                            }}
                            className="flex items-center gap-0.5 text-[9px] text-amber-400 hover:text-amber-300 transition-colors"
                          >
                            <Box className="w-2.5 h-2.5" /> Files ({job.artifacts.length})
                          </button>
                        )}
                        <span className="text-[10px] flex items-center gap-0.5 text-slate-600">
                          Logs <ChevronRight className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
