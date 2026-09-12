import type { DirtyRect } from '../brush';
import type { RasterLayer } from '../layers';

export const TILE_SIZE = 256;

/** 変更のあったタイルの before/after を PNG Blob で保持する軽量パッチ */
export interface TilePatch {
  x: number;
  y: number;
  w: number;
  h: number;
  before: Blob;
  after: Blob;
}

interface PendingTile {
  x: number;
  y: number;
  w: number;
  h: number;
  beforeData: ImageData;
  afterData: ImageData;
}

export interface ExtractTilesOptions {
  /** true なら少数タイルごとにメインスレッドへ yield する (スキャン自体が非同期) */
  batchYield?: boolean;
  shouldContinue?: () => boolean;
  batchSize?: number;
}

export interface ExtractTilesResult {
  /** 同期スキャン時の差分タイル数。batchYield 時は -1 */
  tileCount: number;
  ready: Promise<TilePatch[]>;
}

function encode(img: ImageData): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}

function sameData(a: ImageData, b: ImageData): boolean {
  const ua = new Uint32Array(a.data.buffer);
  const ub = new Uint32Array(b.data.buffer);
  for (let i = 0; i < ua.length; i++) {
    if (ua[i] !== ub[i]) return false;
  }
  return true;
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function encodePending(pending: PendingTile[]): Promise<TilePatch[]> {
  return Promise.all(
    pending.map(async (tile) => ({
      x: tile.x,
      y: tile.y,
      w: tile.w,
      h: tile.h,
      before: await encode(tile.beforeData),
      after: await encode(tile.afterData),
    })),
  );
}

function collectPending(
  beforeCtx: CanvasRenderingContext2D,
  afterCtx: CanvasRenderingContext2D,
  rect: DirtyRect,
  W: number,
  H: number,
): PendingTile[] {
  const minX = Math.max(0, Math.floor(rect.minX));
  const minY = Math.max(0, Math.floor(rect.minY));
  const maxX = Math.min(W, Math.ceil(rect.maxX));
  const maxY = Math.min(H, Math.ceil(rect.maxY));
  if (maxX <= minX || maxY <= minY) return [];

  const tx0 = Math.floor(minX / TILE_SIZE);
  const ty0 = Math.floor(minY / TILE_SIZE);
  const tx1 = Math.floor((maxX - 1) / TILE_SIZE);
  const ty1 = Math.floor((maxY - 1) / TILE_SIZE);
  const pending: PendingTile[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const x = tx * TILE_SIZE;
      const y = ty * TILE_SIZE;
      const w = Math.min(TILE_SIZE, W - x);
      const h = Math.min(TILE_SIZE, H - y);
      const beforeData = beforeCtx.getImageData(x, y, w, h);
      const afterData = afterCtx.getImageData(x, y, w, h);
      if (!sameData(beforeData, afterData)) {
        pending.push({ x, y, w, h, beforeData, afterData });
      }
    }
  }
  return pending;
}

/**
 * before と after を比較し、dirty rect と交差するタイルのうち変化したものだけをパッチ化する。
 * Blob 化は非同期。完了した TilePatch[] は ready で受け取る。
 */
export function extractTiles(
  beforeCtx: CanvasRenderingContext2D,
  afterCtx: CanvasRenderingContext2D,
  rect: DirtyRect,
  W: number,
  H: number,
  opts: ExtractTilesOptions = {},
): ExtractTilesResult {
  const shouldContinue = opts.shouldContinue ?? (() => true);
  const batchSize = Math.max(1, opts.batchSize ?? 4);

  if (!opts.batchYield) {
    const pending = collectPending(beforeCtx, afterCtx, rect, W, H);
    return { tileCount: pending.length, ready: encodePending(pending) };
  }

  const ready = (async () => {
    const minX = Math.max(0, Math.floor(rect.minX));
    const minY = Math.max(0, Math.floor(rect.minY));
    const maxX = Math.min(W, Math.ceil(rect.maxX));
    const maxY = Math.min(H, Math.ceil(rect.maxY));
    if (maxX <= minX || maxY <= minY) return [];

    const tx0 = Math.floor(minX / TILE_SIZE);
    const ty0 = Math.floor(minY / TILE_SIZE);
    const tx1 = Math.floor((maxX - 1) / TILE_SIZE);
    const ty1 = Math.floor((maxY - 1) / TILE_SIZE);
    const pending: PendingTile[] = [];
    let scanned = 0;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!shouldContinue()) throw new Error('tile extraction cancelled');
        const x = tx * TILE_SIZE;
        const y = ty * TILE_SIZE;
        const w = Math.min(TILE_SIZE, W - x);
        const h = Math.min(TILE_SIZE, H - y);
        const beforeData = beforeCtx.getImageData(x, y, w, h);
        const afterData = afterCtx.getImageData(x, y, w, h);
        if (!sameData(beforeData, afterData)) {
          pending.push({ x, y, w, h, beforeData, afterData });
        }
        scanned++;
        if (scanned % batchSize === 0) {
          await yieldToMainThread();
          if (!shouldContinue()) throw new Error('tile extraction cancelled');
        }
      }
    }
    return encodePending(pending);
  })();

  return { tileCount: -1, ready };
}

export async function applyTiles(
  layer: RasterLayer,
  tiles: TilePatch[],
  which: 'before' | 'after',
): Promise<void> {
  for (const t of tiles) {
    const bmp = await createImageBitmap(which === 'before' ? t.before : t.after);
    layer.runtime.ctx.clearRect(t.x, t.y, t.w, t.h);
    layer.runtime.ctx.drawImage(bmp, t.x, t.y);
    bmp.close();
  }
}
