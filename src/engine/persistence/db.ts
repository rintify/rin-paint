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
}

export async function loadProject(): Promise<SavedProject | undefined> {
  return (await db()).get('kv', 'project');
}

export async function addFrame(f: TimelapseFrame): Promise<void> {
  await (await db()).add('frames', f);
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
  const keys = await d.getAllKeys('frames');
  const tx = d.transaction('frames', 'readwrite');
  for (let i = 1; i < keys.length; i += 2) {
    void tx.store.delete(keys[i]);
  }
  await tx.done;
}
