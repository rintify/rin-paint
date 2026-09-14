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

export interface ExtractTilesResult {
  /** 不変タイルの識別子が変化した数。 */
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

export async function applyTiles(
  layer: RasterLayer,
  tiles: TilePatch[],
  which: 'before' | 'after',
): Promise<void> {
  for (const t of tiles) {
    const bmp = await createImageBitmap(which === 'before' ? t.before : t.after);
    layer.runtime.surface.paint({x: t.x, y: t.y, w: t.w, h: t.h}, ctx => {ctx.clearRect(t.x, t.y, t.w, t.h); ctx.drawImage(bmp, t.x, t.y);});
    bmp.close();
  }
}

/** Tile identity comparison never scans transparent gaps or unrelated pixel buffers. */
export function extractSparseTiles(
  before: import('../raster/SparseRaster').SparseRasterSnapshot,
  after: import('../raster/SparseRaster').SparseRasterSnapshot,
): ExtractTilesResult {
  const pending: PendingTile[] = [];
  const context = document.createElement('canvas').getContext('2d')!;
  const image = (pixels?: Uint8ClampedArray) => {const result = context.createImageData(TILE_SIZE, TILE_SIZE); if (pixels) result.data.set(pixels); return result;};
  for (const key of new Set([...before.tiles.keys(), ...after.tiles.keys()])) {
    const a = before.tiles.get(key), b = after.tiles.get(key);
    if (a === b || a?.id === b?.id) continue;
    const [tx, ty] = key.split(',').map(Number);
    pending.push({x: tx * TILE_SIZE, y: ty * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE,
      beforeData: image(a?.pixels),
      afterData: image(b?.pixels)});
  }
  return {tileCount: pending.length, ready: encodePending(pending)};
}
