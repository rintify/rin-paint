import { openDB, type IDBPDatabase } from 'idb';
import type { AdjustParams, BlendMode, LayerType, ShapeParams, ToolInstance } from '../../types';
import type { PersistedHistory } from '../history/historyTree';
import type { ViewState } from '../view';

export interface SavedLayer {
  id: string;
  type: LayerType;
  name: string;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  parentId: string | null;
  childIds: string[];
  params?: AdjustParams;
  shape?: ShapeParams;
  blob?: Blob;
}

export interface SavedProject {
  version: 2;
  rootLayerIds: string[];
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
  /** 履歴の全分岐と現在位置 (古い保存データには無い) */
  history?: PersistedHistory;
  /** パン・拡大率・回転 (古い保存データには無い) */
  view?: ViewState;
}

export interface TimelapseFrame {
  t: number;
  blob: Blob;
}

export interface SavedReferenceImage {
  blob: Blob;
  name: string;
  naturalWidth: number;
  naturalHeight: number;
  x: number;
  y: number;
  width: number;
  rotation: number;
  opacity: number;
  locked: boolean;
}

const DB_NAME = 'rin-paint';

let dbPromise: Promise<IDBPDatabase> | null = null;
let projectBytes = 0;
let frameBytes: number | null = null;
let frameBytesPromise: Promise<number> | null = null;

function savedProjectBytes(project: SavedProject | undefined): number {
  if (!project) return 0;
  let bytes = project.layers.reduce(
    (sum, layer) => sum + (layer.blob?.size ?? 0),
    0,
  );
  for (const node of project.history?.nodes ?? []) {
    const op = node.op;
    if (!op) continue;
    if (op.kind === 'raster') {
      for (const tile of op.tiles) bytes += tile.before.size + tile.after.size;
    } else if (op.kind === 'layerAdd') {
      bytes += op.snapshot.blob?.size ?? 0;
    } else if (op.kind === 'layerRemove') {
      for (const snapshot of op.snapshots) bytes += snapshot.blob?.size ?? 0;
    } else if (op.kind === 'layerMerge') {
      for (const entry of [...op.before, ...op.after]) {
        bytes += entry.snapshot.blob?.size ?? 0;
      }
    }
  }
  return bytes;
}

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
  projectBytes = savedProjectBytes(p);
}

export async function loadProject(): Promise<SavedProject | undefined> {
  const project = await (await db()).get('kv', 'project') as SavedProject | undefined;
  projectBytes = savedProjectBytes(project);
  return project;
}

export async function saveReferenceImage(image: SavedReferenceImage): Promise<void> {
  await (await db()).put('kv', image, 'reference-image');
}

export async function loadReferenceImage(): Promise<SavedReferenceImage | undefined> {
  return (await (await db()).get('kv', 'reference-image')) as
    | SavedReferenceImage
    | undefined;
}

export async function clearReferenceImage(): Promise<void> {
  await (await db()).delete('kv', 'reference-image');
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
