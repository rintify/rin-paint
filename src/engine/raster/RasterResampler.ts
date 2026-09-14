import { RasterWarpMesh } from './RasterWarpMesh';
import { RasterEditSession, RasterSurface } from './RasterSurface';
import {
  intersect,
  tileCoordinates,
  tileKey,
  tileRect,
  TILE_SIZE,
  validateRect,
  rasterCanvas,
  yieldRaster,
  type PixelRect,
  type TileKey,
} from './geometry';
export interface RasterPoint {
  x: number;
  y: number;
}
type Quad = readonly RasterPoint[];
function box(points: readonly RasterPoint[], pad = 0): PixelRect {
  const x = Math.floor(Math.min(...points.map((p) => p.x)) - pad),
    y = Math.floor(Math.min(...points.map((p) => p.y)) - pad);
  return {
    x,
    y,
    w: Math.ceil(Math.max(...points.map((p) => p.x)) + pad) - x,
    h: Math.ceil(Math.max(...points.map((p) => p.y)) + pad) - y,
  };
}
/** Destination sampling across source tiles avoids seams and transparent edge fringes. */
export class RasterResampler {
  static draw(
    source: RasterSurface,
    sourceRect: PixelRect,
    corners: Quad,
    target: RasterEditSession,
    clip?: PixelRect,
  ): void {
    for (const _ of this.steps(source, sourceRect, corners, target, clip)) {
      /* Synchronous preview / atomic tool callbacks. */
    }
  }
  static async drawAsync(
    source: RasterSurface,
    sourceRect: PixelRect,
    corners: Quad,
    target: RasterEditSession,
    clip?: PixelRect,
  ): Promise<void> {
    let count = 0;
    for (const _ of this.steps(source, sourceRect, corners, target, clip))
      if (++count % 4 === 0) await yieldRaster();
  }
  static async scaleAsync(
    source: RasterSurface,
    factor: number,
  ): Promise<RasterSurface> {
    if (factor === 1) return source.clone();
    const result = new RasterSurface(),
      r = source.getContentBounds();
    if (!r) return result;
    const edit = new RasterEditSession(result);
    try {
      await this.drawAsync(
        source,
        r,
        [
          { x: r.x * factor, y: r.y * factor },
          { x: (r.x + r.w) * factor, y: r.y * factor },
          { x: (r.x + r.w) * factor, y: (r.y + r.h) * factor },
          { x: r.x * factor, y: (r.y + r.h) * factor },
        ],
        edit,
      );
      edit.commit();
      return result;
    } catch (error) {
      edit.cancel();
      throw error;
    }
  }
  private static *steps(
    source: RasterSurface,
    sourceRect: PixelRect,
    corners: Quad,
    target: RasterEditSession,
    clip?: PixelRect,
  ): Generator<void> {
    const destBounds = box(corners, 2);
    validateRect(destBounds);
    const dx = corners[0].x - sourceRect.x,
      dy = corners[0].y - sourceRect.y;
    const translation =
      Number.isInteger(dx) &&
      Number.isInteger(dy) &&
      corners.every(
        (p, i) =>
          p.x === sourceRect.x + (i === 1 || i === 2 ? sourceRect.w : 0) + dx &&
          p.y === sourceRect.y + (i >= 2 ? sourceRect.h : 0) + dy,
      );
    if (translation) {
      for (const t of source.entries()) {
        const r = intersect(tileRect(t.tx, t.ty), sourceRect);
        if (!r) continue;
        const dest = { ...r, x: r.x + dx, y: r.y + dy },
          clipped = clip ? intersect(dest, clip) : dest;
        if (!clipped) continue;
        target.mutateRegion(clipped, (ctx) =>
          ctx.drawImage(
            t.asset.canvas!,
            t.tx * TILE_SIZE + dx,
            t.ty * TILE_SIZE + dy,
          ),
        );
        yield;
      }
      return;
    }
    const mesh = new RasterWarpMesh(corners);
    const candidates = new Map<TileKey, { tx: number; ty: number }>();
    for (const t of source.entries()) {
      const r = intersect(
        {
          x: t.tx * TILE_SIZE + t.asset.bounds.x - 1,
          y: t.ty * TILE_SIZE + t.asset.bounds.y - 1,
          w: t.asset.bounds.w + 2,
          h: t.asset.bounds.h + 2,
        },
        sourceRect,
      );
      if (!r) continue;
      const points = mesh.regionPoints(
        (r.x - sourceRect.x) / sourceRect.w,
        (r.y - sourceRect.y) / sourceRect.h,
        (r.x + r.w - sourceRect.x) / sourceRect.w,
        (r.y + r.h - sourceRect.y) / sourceRect.h,
      );
      const area = clip ? intersect(box(points, 2), clip) : box(points, 2);
      if (!area) continue;
      for (const t of tileCoordinates(area))
        candidates.set(tileKey(t.tx, t.ty), t);
    }
    const data = new Map<TileKey, Uint8ClampedArray>();
    const pixel = (x: number, y: number): ArrayLike<number> => {
      if (
        x < sourceRect.x ||
        y < sourceRect.y ||
        x >= sourceRect.x + sourceRect.w ||
        y >= sourceRect.y + sourceRect.h
      )
        return [0, 0, 0, 0];
      const tx = Math.floor(x / TILE_SIZE),
        ty = Math.floor(y / TILE_SIZE),
        key = tileKey(tx, ty),
        tile = source.get(tx, ty);
      if (!tile) return [0, 0, 0, 0];
      let a = data.get(key);
      if (!a) {
        a = tile
          .canvas!.getContext('2d')!
          .getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
        data.set(key, a);
      }
      const i = ((y - ty * TILE_SIZE) * TILE_SIZE + x - tx * TILE_SIZE) * 4;
      return a.subarray(i, i + 4);
    };
    for (const { tx, ty } of candidates.values()) {
      const r = tileRect(tx, ty),
        image = rasterCanvas()
          .getContext('2d')!
          .createImageData(TILE_SIZE, TILE_SIZE);
      const sample = mesh.sampler(r);
      for (let y = 0; y < TILE_SIZE; y++)
        for (let x = 0; x < TILE_SIZE; x++) {
          const wx = r.x + x + 0.5,
            wy = r.y + y + 0.5;
          if (
            clip &&
            (wx < clip.x ||
              wy < clip.y ||
              wx >= clip.x + clip.w ||
              wy >= clip.y + clip.h)
          )
            continue;
          const uv = sample(wx, wy);
          if (!uv) continue;
          const u = uv.x,
            v = uv.y;
          const sx = sourceRect.x + u * sourceRect.w - 0.5,
            sy = sourceRect.y + v * sourceRect.h - 0.5,
            ix = Math.floor(sx),
            iy = Math.floor(sy),
            fx = sx - ix,
            fy = sy - iy;
          const samples = [
              pixel(ix, iy),
              pixel(ix + 1, iy),
              pixel(ix, iy + 1),
              pixel(ix + 1, iy + 1),
            ],
            weights = [
              (1 - fx) * (1 - fy),
              fx * (1 - fy),
              (1 - fx) * fy,
              fx * fy,
            ];
          let alpha = 0;
          const rgb = [0, 0, 0];
          samples.forEach((p, i) => {
            const aw = p[3] * weights[i];
            alpha += aw;
            for (let k = 0; k < 3; k++) rgb[k] += p[k] * aw;
          });
          const i = (y * TILE_SIZE + x) * 4;
          if (alpha) {
            for (let k = 0; k < 3; k++) image.data[i + k] = rgb[k] / alpha;
            image.data[i + 3] = alpha;
          }
        }
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = TILE_SIZE;
      canvas.getContext('2d')!.putImageData(image, 0, 0);
      target.mutateRegion(r, (ctx) => ctx.drawImage(canvas, r.x, r.y));
      yield;
    }
  }
  static scale(source: RasterSurface, factor: number): RasterSurface {
    if (factor === 1) return source.clone();
    const result = new RasterSurface(),
      r = source.getContentBounds();
    if (!r) return result;
    const edit = new RasterEditSession(result);
    this.draw(
      source,
      r,
      [
        { x: r.x * factor, y: r.y * factor },
        { x: (r.x + r.w) * factor, y: r.y * factor },
        { x: (r.x + r.w) * factor, y: (r.y + r.h) * factor },
        { x: r.x * factor, y: (r.y + r.h) * factor },
      ],
      edit,
    );
    edit.commit();
    return result;
  }
}
