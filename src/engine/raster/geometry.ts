import { rasterStats } from './RasterMetrics';
export const TILE_SIZE = 256;
export const WORLD_LIMIT = 2 ** 30;
export type TileKey = `${number},${number}`;
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const tileKey = (tx: number, ty: number): TileKey => `${tx},${ty}`;
export const tileRect = (tx: number, ty: number): PixelRect => ({
  x: tx * TILE_SIZE,
  y: ty * TILE_SIZE,
  w: TILE_SIZE,
  h: TILE_SIZE,
});
export function validateRect(r: PixelRect): void {
  if (
    ![r.x, r.y, r.w, r.h].every(Number.isFinite) ||
    r.w < 0 ||
    r.h < 0 ||
    r.x < -WORLD_LIMIT ||
    r.y < -WORLD_LIMIT ||
    r.x + r.w > WORLD_LIMIT ||
    r.y + r.h > WORLD_LIMIT
  ) {
    throw new Error('画像の座標が扱える範囲を超えています');
  }
}
export function intersect(a: PixelRect, b: PixelRect): PixelRect | null {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w),
    bottom = Math.min(a.y + a.h, b.y + b.h);
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
}
export function union(a: PixelRect | null, b: PixelRect): PixelRect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}
export function* tileCoordinates(
  rect: PixelRect,
): Generator<{ tx: number; ty: number }> {
  validateRect(rect);
  if (rect.w <= 0 || rect.h <= 0) return;
  for (
    let ty = Math.floor(rect.y / TILE_SIZE);
    ty < Math.ceil((rect.y + rect.h) / TILE_SIZE);
    ty++
  )
    for (
      let tx = Math.floor(rect.x / TILE_SIZE);
      tx < Math.ceil((rect.x + rect.w) / TILE_SIZE);
      tx++
    )
      yield { tx, ty };
}
export function rasterCanvas(w = TILE_SIZE, h = TILE_SIZE): HTMLCanvasElement {
  if (w > 8192 || h > 8192 || w * h > 16 * 1024 * 1024)
    throw new Error('一時画像が大きすぎます');
  rasterStats.maxTemporaryPixels = Math.max(
    rasterStats.maxTemporaryPixels,
    w * h,
  );
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  if (!canvas.getContext('2d'))
    throw new Error('画像用のメモリを確保できませんでした');
  return canvas;
}
export const yieldRaster = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));
