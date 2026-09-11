import type { RasterLayer } from '../layers';
import type { DirtyRect } from '../brush';

export const TILE = 256;

/** 変更のあったタイルの before/after を PNG Blob で保持する軽量パッチ */
export interface TilePatch {
  x: number;
  y: number;
  w: number;
  h: number;
  before: Blob;
  after: Blob;
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

/**
 * before(スクラッチ)と after(レイヤー本体)を比較し、dirty rect と交差する
 * タイルのうち実際に変化したものだけをパッチ化する。
 * Blob 化は非同期なので、完了を ready で待てるようにして返す。
 */
export function extractTiles(
  beforeCtx: CanvasRenderingContext2D,
  afterCtx: CanvasRenderingContext2D,
  rect: DirtyRect,
  W: number,
  H: number,
): { tiles: TilePatch[]; ready: Promise<void> } {
  const minX = Math.max(0, Math.floor(rect.minX));
  const minY = Math.max(0, Math.floor(rect.minY));
  const maxX = Math.min(W, Math.ceil(rect.maxX));
  const maxY = Math.min(H, Math.ceil(rect.maxY));
  const tiles: TilePatch[] = [];
  const jobs: Promise<void>[] = [];
  if (maxX <= minX || maxY <= minY) return { tiles, ready: Promise.resolve() };

  const tx0 = Math.floor(minX / TILE);
  const ty0 = Math.floor(minY / TILE);
  const tx1 = Math.floor((maxX - 1) / TILE);
  const ty1 = Math.floor((maxY - 1) / TILE);

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const x = tx * TILE;
      const y = ty * TILE;
      const w = Math.min(TILE, W - x);
      const h = Math.min(TILE, H - y);
      const a = beforeCtx.getImageData(x, y, w, h);
      const b = afterCtx.getImageData(x, y, w, h);
      if (sameData(a, b)) continue;
      const patch: TilePatch = { x, y, w, h, before: null!, after: null! };
      tiles.push(patch);
      jobs.push(
        encode(a).then((blob) => {
          patch.before = blob;
        }),
        encode(b).then((blob) => {
          patch.after = blob;
        }),
      );
    }
  }
  return { tiles, ready: Promise.all(jobs).then(() => undefined) };
}

/**
 * 全面合成のように dirty rect が大きい処理向けのタイル抽出。
 * 少数タイルずつ PNG 化して、全画素分の ImageData を同時に保持しない。
 */
export async function extractTilesBatched(
  beforeCtx: CanvasRenderingContext2D,
  afterCtx: CanvasRenderingContext2D,
  rect: DirtyRect,
  W: number,
  H: number,
  shouldContinue: () => boolean = () => true,
  batchSize = 4,
): Promise<TilePatch[]> {
  const minX = Math.max(0, Math.floor(rect.minX));
  const minY = Math.max(0, Math.floor(rect.minY));
  const maxX = Math.min(W, Math.ceil(rect.maxX));
  const maxY = Math.min(H, Math.ceil(rect.maxY));
  if (maxX <= minX || maxY <= minY) return [];

  const tx0 = Math.floor(minX / TILE);
  const ty0 = Math.floor(minY / TILE);
  const tx1 = Math.floor((maxX - 1) / TILE);
  const ty1 = Math.floor((maxY - 1) / TILE);
  const tiles: TilePatch[] = [];
  let jobs: Promise<void>[] = [];
  let scanned = 0;

  const flush = async () => {
    await Promise.all(jobs);
    jobs = [];
    if (!shouldContinue()) throw new Error('tile extraction cancelled');
    await yieldToMainThread();
  };

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!shouldContinue()) throw new Error('tile extraction cancelled');
      const x = tx * TILE;
      const y = ty * TILE;
      const w = Math.min(TILE, W - x);
      const h = Math.min(TILE, H - y);
      const a = beforeCtx.getImageData(x, y, w, h);
      const b = afterCtx.getImageData(x, y, w, h);
      if (!sameData(a, b)) {
        const patch: TilePatch = { x, y, w, h, before: null!, after: null! };
        tiles.push(patch);
        jobs.push(
          encode(a).then((blob) => { patch.before = blob; }),
          encode(b).then((blob) => { patch.after = blob; }),
        );
      }
      scanned++;
      if (scanned % Math.max(1, batchSize) === 0) await flush();
    }
  }
  if (jobs.length) await flush();
  return tiles;
}

export async function applyTiles(
  layer: RasterLayer,
  tiles: TilePatch[],
  which: 'before' | 'after',
): Promise<void> {
  for (const t of tiles) {
    const bmp = await createImageBitmap(which === 'before' ? t.before : t.after);
    layer.ctx.clearRect(t.x, t.y, t.w, t.h);
    layer.ctx.drawImage(bmp, t.x, t.y);
    bmp.close();
  }
}
