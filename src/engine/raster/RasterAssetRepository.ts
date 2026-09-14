import {
  rasterCanvas,
  TILE_SIZE,
  yieldRaster,
  type PixelRect,
} from './geometry';
export interface RasterAsset {
  id: string;
  canvas?: HTMLCanvasElement;
  blob?: Blob;
  bounds: PixelRect;
  encoding?: Promise<Blob>;
  decoding?: Promise<RasterAsset>;
  lastUsed?: number;
}
export interface StoredRasterContent {
  kind: 'raster-tiles';
  tileSize: 256;
  tiles: Array<{ tx: number; ty: number; assetId: string }>;
}
const assets = new Map<string, RasterAsset>();
let activeEncodes = 0;
const waiting: Array<() => void> = [];
let accessClock = 0;
export { rasterStats } from './RasterMetrics';
import { rasterStats } from './RasterMetrics';
export function createAsset(
  canvas: HTMLCanvasElement,
  bounds: PixelRect,
): RasterAsset {
  const asset = { id: crypto.randomUUID(), canvas, bounds };
  return asset;
}
export function publishAsset(asset: RasterAsset): void {
  assets.set(asset.id, asset);
}
export function getAsset(id: string): RasterAsset {
  const asset = assets.get(id);
  if (!asset) throw new Error(`画像タイルが見つかりません: ${id}`);
  asset.lastUsed = ++accessClock;
  return asset;
}
export async function encodeAsset(id: string): Promise<Blob> {
  const asset = getAsset(id);
  if (asset.blob) return asset.blob;
  if (asset.encoding) return asset.encoding;
  asset.encoding = (async () => {
    if (activeEncodes >= 4)
      await new Promise<void>((resolve) => waiting.push(resolve));
    else activeEncodes++;
    try {
      const canvas = asset.canvas;
      if (!canvas) throw new Error('画像タイルを保存できません');
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b
              ? resolve(b)
              : reject(new Error('画像タイルの保存に失敗しました')),
          'image/png',
        ),
      );
      asset.blob = blob;
      rasterStats.encodedTiles++;
      return blob;
    } finally {
      const resume = waiting.shift();
      if (resume) resume();
      else activeEncodes--;
      asset.encoding = undefined;
    }
  })();
  return asset.encoding;
}
export async function decodeAsset(id: string): Promise<RasterAsset> {
  const asset = getAsset(id);
  if (asset.canvas) return asset;
  if (asset.decoding) return asset.decoding;
  asset.decoding = (async () => {
    if (!asset.blob) throw new Error('画像タイルが破損しています');
    const bitmap = await createImageBitmap(asset.blob);
    try {
      if (bitmap.width !== TILE_SIZE || bitmap.height !== TILE_SIZE)
        throw new Error('画像タイルのサイズが不正です');
      const canvas = rasterCanvas();
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      asset.canvas = canvas;
      return asset;
    } finally {
      bitmap.close();
    }
  })();
  try {
    return await asset.decoding;
  } finally {
    asset.decoding = undefined;
  }
}
export function registerAsset(
  id: string,
  blob: Blob,
  bounds: PixelRect = { x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE },
): void {
  if (!assets.has(id)) assets.set(id, { id, blob, bounds });
}
export function collectAssetIds(
  value: unknown,
  out = new Set<string>(),
  seen = new WeakSet<object>(),
): Set<string> {
  if (
    !value ||
    typeof value !== 'object' ||
    value instanceof Blob ||
    (typeof HTMLCanvasElement !== 'undefined' &&
      value instanceof HTMLCanvasElement)
  )
    return out;
  if (seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectAssetIds(item, out, seen);
    return out;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.assetId === 'string') out.add(record.assetId);
  if (
    'tx' in record &&
    'ty' in record &&
    'before' in record &&
    'after' in record
  ) {
    if (typeof record.before === 'string') out.add(record.before);
    if (typeof record.after === 'string') out.add(record.after);
  }
  for (const item of Object.values(record)) collectAssetIds(item, out, seen);
  return out;
}
export async function assetBlobs(
  value: unknown,
): Promise<Record<string, Blob>> {
  const result: Record<string, Blob> = {};
  const ids = [...collectAssetIds(value)];
  for (const id of ids) pins.set(id, (pins.get(id) ?? 0) + 1);
  try {
    const pending: string[] = [];
    for (const id of ids) {
      const blob = getAsset(id).blob;
      if (blob) result[id] = blob;
      else pending.push(id);
    }
    for (let i = 0; i < pending.length; i += 4) {
      await Promise.all(
        pending.slice(i, i + 4).map(async (id) => {
          result[id] = await encodeAsset(id);
        }),
      );
      if (i + 4 < pending.length) await yieldRaster();
    }
  } finally {
    for (const id of ids) {
      const count = pins.get(id)! - 1;
      if (count) pins.set(id, count);
      else pins.delete(id);
    }
  }
  return result;
}
export function assetBytes(id: string): number {
  const a = assets.get(id);
  return a?.blob?.size ?? TILE_SIZE * TILE_SIZE * 4;
}
export function releaseUnusedCanvases(
  liveIds: Set<string>,
  limitBytes = 128 * 1024 * 1024,
): void {
  let retained = 0;
  for (const asset of [...assets.values()].sort(
    (a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0),
  )) {
    if (!asset.canvas || liveIds.has(asset.id) || !asset.blob || asset.encoding)
      continue;
    retained += TILE_SIZE * TILE_SIZE * 4;
    if (retained > limitBytes) asset.canvas = undefined;
  }
}

/** Remap only raster references, never layer IDs or user text. Used to isolate imported assets. */
export function remapRasterAssetIds(
  value: unknown,
  ids: Map<string, string>,
): void {
  if (!value || typeof value !== 'object' || value instanceof Blob) return;
  if (Array.isArray(value)) {
    for (const item of value) remapRasterAssetIds(item, ids);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.assetId === 'string')
    record.assetId = ids.get(record.assetId) ?? record.assetId;
  if (
    'tx' in record &&
    'ty' in record &&
    'before' in record &&
    'after' in record
  ) {
    for (const side of ['before', 'after'])
      if (typeof record[side] === 'string')
        record[side] = ids.get(record[side]) ?? record[side];
  }
  for (const item of Object.values(record)) remapRasterAssetIds(item, ids);
}

const pins = new Map<string, number>();
let runtimeRoots: () => Set<string> | null = () => new Set();
export function setRasterRootsProvider(
  provider: () => Set<string> | null,
): void {
  runtimeRoots = provider;
}
export function rasterAssetCollectionCandidates(): string[] {
  return [...assets.keys()];
}
/** Called only from the serialized persistence collector. Newer publications are excluded. */
export function collectUnusedMemoryAssets(
  persisted: Set<string>,
  candidates: string[],
): void {
  const live = runtimeRoots();
  if (!live) return;
  for (const id of candidates) {
    if (
      !persisted.has(id) &&
      !live.has(id) &&
      !pins.has(id) &&
      !assets.get(id)?.encoding
    )
      assets.delete(id);
  }
}
