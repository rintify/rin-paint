import { openDB, type IDBPDatabase } from 'idb';
import type { AdjustParams, BlendMode, LayerType, ToolInstance } from '../../types';

export interface SavedLayer {
  id: string;
  type: LayerType;
  name: string;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  params?: AdjustParams;
  blob?: Blob;
}

export interface SavedProject {
  layers: SavedLayer[];
  activeLayerId: string;
  penColor: string;
  penSize: number;
  colorHistory: string[];
  /** アートボードサイズ (古い保存データには無い) */
  width?: number;
  height?: number;
  /** ツールインスタンス (古い保存データには無い) */
  tools?: ToolInstance[];
  activeToolId?: string;
}

export interface TimelapseFrame {
  t: number;
  blob: Blob;
}

const DB_NAME = 'rin-paint';

let dbPromise: Promise<IDBPDatabase> | null = null;
let projectBytes = 0;
let frameBytes: number | null = null;
let frameBytesPromise: Promise<number> | null = null;
function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('kv');
      d.createObjectStore('frames', { autoIncrement: true });
    },
  });
  return dbPromise;
}

export async function saveProject(p: SavedProject): Promise<void> {
  await (await db()).put('kv', p, 'project');
  projectBytes = p.layers.reduce((sum, layer) => sum + (layer.blob?.size ?? 0), 0);
}

export async function loadProject(): Promise<SavedProject | undefined> {
  const project = await (await db()).get('kv', 'project') as SavedProject | undefined;
  projectBytes = project?.layers.reduce(
    (sum, layer) => sum + (layer.blob?.size ?? 0),
    0,
  ) ?? 0;
  return project;
}

export async function addFrame(f: TimelapseFrame): Promise<void> {
  await ensureFrameBytes();
  await (await db()).add('frames', f);
  frameBytes! += f.blob.size;
}

export async function frameCount(): Promise<number> {
  return (await db()).count('frames');
}

export async function getFrames(): Promise<TimelapseFrame[]> {
  return (await db()).getAll('frames');
}

/** フレーム数が上限を超えたら1つおきに間引いて時間方向の網羅性を保つ */
export async function thinFramesIfNeeded(max: number): Promise<void> {
  const d = await db();
  const count = await d.count('frames');
  if (count <= max) return;
  await ensureFrameBytes();
  const entries = await d.getAll('frames') as TimelapseFrame[];
  const keys = await d.getAllKeys('frames');
  let removedBytes = 0;
  const tx = d.transaction('frames', 'readwrite');
  for (let i = 1; i < keys.length; i += 2) {
    void tx.store.delete(keys[i]);
    removedBytes += entries[i]?.blob.size ?? 0;
  }
  await tx.done;
  frameBytes! -= removedBytes;
}

async function ensureFrameBytes(): Promise<number> {
  if (frameBytes !== null) return frameBytes;
  frameBytesPromise ??= (async () => {
    const frames = await (await db()).getAll('frames') as TimelapseFrame[];
    frameBytes = frames.reduce((sum, frame) => sum + frame.blob.size, 0);
    return frameBytes;
  })().catch((error) => {
    frameBytesPromise = null;
    throw error;
  });
  return frameBytesPromise;
}

export async function loadTimelapseEnabled(): Promise<boolean> {
  const value = await (await db()).get('kv', 'timelapse-enabled');
  return typeof value === 'boolean' ? value : true;
}

export async function saveTimelapseEnabled(enabled: boolean): Promise<void> {
  await (await db()).put('kv', enabled, 'timelapse-enabled');
}

export interface PersistenceUsage {
  project: number;
  timelapse: number;
  other: number;
}

export async function getPersistenceUsage(): Promise<PersistenceUsage> {
  const timelapse = await ensureFrameBytes();
  let originUsage = projectBytes + timelapse;
  try {
    originUsage = (await navigator.storage?.estimate?.())?.usage ?? originUsage;
  } catch {
    // StorageManager が利用できない環境では既知の Blob サイズだけを使う。
  }
  return {
    project: projectBytes,
    timelapse,
    other: Math.max(0, originUsage - projectBytes - timelapse),
  };
}
