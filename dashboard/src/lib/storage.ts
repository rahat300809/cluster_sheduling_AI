import {
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  listAll,
  deleteObject,
  getMetadata,
  UploadTask,
} from 'firebase/storage';
import { storage } from './firebase';

// ─── Dataset Storage Helpers ──────────────────────────────────────────────────

/** Max file size: 500 MB */
export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;

export interface DatasetUploadProgress {
  bytesTransferred: number;
  totalBytes: number;
  percent: number;
  state: 'running' | 'paused' | 'success' | 'error' | 'canceled';
}

export interface StoredDatasetFile {
  name: string;
  storagePath: string;
  downloadUrl: string;
  size: number;
  type: string;
  uploadedAt: number;
}

/**
 * Upload a dataset file to Firebase Storage.
 * Path: datasets/{userId}/{notebookId}/{filename}
 *
 * Returns an object with the UploadTask (for progress tracking) and a promise
 * that resolves with the stored file metadata on completion.
 */
export function uploadDatasetFile(
  userId: string,
  notebookId: string,
  file: File,
  onProgress?: (progress: DatasetUploadProgress) => void
): { task: UploadTask; promise: Promise<StoredDatasetFile> } {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File "${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 500 MB.`
    );
  }

  const path = `datasets/${userId}/${notebookId}/${file.name}`;
  const fileRef = storageRef(storage, path);
  const task = uploadBytesResumable(fileRef, file, {
    contentType: file.type || 'application/octet-stream',
    customMetadata: {
      uploadedAt: Date.now().toString(),
      originalName: file.name,
    },
  });

  const promise = new Promise<StoredDatasetFile>((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot) => {
        const percent = snapshot.totalBytes > 0
          ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
          : 0;
        onProgress?.({
          bytesTransferred: snapshot.bytesTransferred,
          totalBytes: snapshot.totalBytes,
          percent,
          state: snapshot.state as DatasetUploadProgress['state'],
        });
      },
      (error) => reject(error),
      async () => {
        try {
          const downloadUrl = await getDownloadURL(task.snapshot.ref);
          resolve({
            name: file.name,
            storagePath: path,
            downloadUrl,
            size: file.size,
            type: file.type || 'application/octet-stream',
            uploadedAt: Date.now(),
          });
        } catch (err) {
          reject(err);
        }
      }
    );
  });

  return { task, promise };
}

/**
 * Get the download URL for a file in Firebase Storage.
 */
export async function getDatasetDownloadUrl(storagePath: string): Promise<string> {
  const fileRef = storageRef(storage, storagePath);
  return getDownloadURL(fileRef);
}

/**
 * List all dataset files for a notebook.
 */
export async function listDatasetFiles(
  userId: string,
  notebookId: string
): Promise<StoredDatasetFile[]> {
  const folderRef = storageRef(storage, `datasets/${userId}/${notebookId}`);
  try {
    const result = await listAll(folderRef);
    const files: StoredDatasetFile[] = [];

    for (const itemRef of result.items) {
      try {
        const [url, meta] = await Promise.all([
          getDownloadURL(itemRef),
          getMetadata(itemRef),
        ]);
        files.push({
          name: itemRef.name,
          storagePath: itemRef.fullPath,
          downloadUrl: url,
          size: meta.size,
          type: meta.contentType ?? 'application/octet-stream',
          uploadedAt: parseInt(meta.customMetadata?.uploadedAt ?? '0', 10),
        });
      } catch {
        // Skip files that fail to load metadata
      }
    }

    return files.sort((a, b) => b.uploadedAt - a.uploadedAt);
  } catch {
    return [];
  }
}

/**
 * Delete a dataset file from Firebase Storage.
 */
export async function deleteDatasetFile(storagePath: string): Promise<void> {
  const fileRef = storageRef(storage, storagePath);
  await deleteObject(fileRef);
}

/**
 * Delete all dataset files for a notebook.
 */
export async function deleteAllNotebookDatasets(
  userId: string,
  notebookId: string
): Promise<void> {
  const folderRef = storageRef(storage, `datasets/${userId}/${notebookId}`);
  try {
    const result = await listAll(folderRef);
    await Promise.all(result.items.map((item) => deleteObject(item)));
  } catch {
    // Folder may not exist
  }
}

/**
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Get file type icon category based on extension.
 */
export function getFileTypeCategory(filename: string): 'data' | 'image' | 'archive' | 'model' | 'code' | 'other' {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (['csv', 'tsv', 'json', 'jsonl', 'parquet', 'xlsx', 'xls', 'feather', 'arrow'].includes(ext)) return 'data';
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'svg'].includes(ext)) return 'image';
  if (['zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz', 'tgz'].includes(ext)) return 'archive';
  if (['h5', 'hdf5', 'pkl', 'pt', 'pth', 'onnx', 'pb', 'tflite', 'safetensors'].includes(ext)) return 'model';
  if (['py', 'ipynb', 'txt', 'md', 'yaml', 'yml', 'toml', 'cfg', 'ini'].includes(ext)) return 'code';
  return 'other';
}
