import { rasterStats } from './RasterMetrics';
import { RasterTransformPlan, pointBounds } from './RasterTransformPlan';
import { RasterAffineRenderer } from './RasterAffineRenderer';
import { RasterEditSession, RasterSurface } from './RasterSurface';
import {
  intersect,
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
export interface RasterResampleCache {
  plan?: RasterTransformPlan;
  pixels: Map<TileKey, Uint8ClampedArray>;
  affine: RasterAffineRenderer;
}
/** Destination sampling across source tiles avoids seams and transparent edge fringes. */
export class RasterResampler {
  static draw(
    source: RasterSurface,
    sourceRect: PixelRect,
    corners: Quad,
    target: RasterEditSession,
    clip?: PixelRect,
    cache?: RasterResampleCache,
  ): void {
    for (const _ of this.steps(
      source,
      sourceRect,
      corners,
      target,
      clip,
      cache,
    )) {
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
    cache?: RasterResampleCache,
  ): Generator<void> {
    const destBounds = pointBounds(corners, 2);
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
      const requested = clip
        ? intersect(sourceRect, { ...clip, x: clip.x - dx, y: clip.y - dy })
        : sourceRect;
      if (!requested) return;
      for (const t of source.queryTiles(requested)) {
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
    const plan =
      cache?.plan ?? new RasterTransformPlan(source, sourceRect, corners);
    const mesh = plan.mesh,
      candidates = plan.candidates(clip);
    const native = cache?.affine ?? new RasterAffineRenderer();
    const data = cache?.pixels ?? new Map<TileKey, Uint8ClampedArray>();
    let lastTx = NaN,
      lastTy = NaN,
      pixels: Uint8ClampedArray | undefined;
    let alpha = 0,
      red = 0,
      green = 0,
      blue = 0;
    const accumulate = (x: number, y: number, weight: number): void => {
      if (
        !weight ||
        x < sourceRect.x ||
        y < sourceRect.y ||
        x >= sourceRect.x + sourceRect.w ||
        y >= sourceRect.y + sourceRect.h
      )
        return;
      const tx = Math.floor(x / TILE_SIZE),
        ty = Math.floor(y / TILE_SIZE);
      if (tx !== lastTx || ty !== lastTy) {
        lastTx = tx;
        lastTy = ty;
        const key = tileKey(tx, ty);
        pixels = data.get(key);
        if (!pixels) {
          const tile = source.get(tx, ty);
          if (tile) {
            pixels = tile
              .canvas!.getContext('2d')!
              .getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
            data.set(key, pixels);
            rasterStats.sourceReadbackPixels += TILE_SIZE * TILE_SIZE;
          }
        }
      }
      if (!pixels) return;
      const i = ((y - ty * TILE_SIZE) * TILE_SIZE + x - tx * TILE_SIZE) * 4;
      const aw = pixels[i + 3] * weight;
      alpha += aw;
      red += pixels[i] * aw;
      green += pixels[i + 1] * aw;
      blue += pixels[i + 2] * aw;
    };
    let canvas: HTMLCanvasElement | undefined;
    let buffer: ImageData | undefined;
    for (const { tx, ty } of candidates) {
      const r = tileRect(tx, ty);
      const occupied = intersect(r, destBounds),
        area = occupied && (clip ? intersect(occupied, clip) : occupied);
      if (!area) continue;
      if (native.draw(source, plan, area, target)) {
        yield;
        continue;
      }
      const scratch = (canvas ??= rasterCanvas());
      const ctx = scratch.getContext('2d')!;
      const image = (buffer ??= ctx.createImageData(TILE_SIZE, TILE_SIZE));
      image.data.fill(0);
      mesh.forEachSpan(area, (span) => {
        const wy = span.y + 0.5;
        for (let wxInt = span.x0; wxInt < span.x1; wxInt++) {
          const wx = wxInt + 0.5;
          const u = span.ux * wx + span.uy * wy + span.u0;
          const v = span.vx * wx + span.vy * wy + span.v0;
          const sx = sourceRect.x + u * sourceRect.w - 0.5,
            sy = sourceRect.y + v * sourceRect.h - 0.5,
            ix = Math.floor(sx),
            iy = Math.floor(sy),
            fx = sx - ix,
            fy = sy - iy;
          alpha = red = green = blue = 0;
          accumulate(ix, iy, (1 - fx) * (1 - fy));
          accumulate(ix + 1, iy, fx * (1 - fy));
          accumulate(ix, iy + 1, (1 - fx) * fy);
          accumulate(ix + 1, iy + 1, fx * fy);
          rasterStats.sampledPixels++;
          const i = ((span.y - r.y) * TILE_SIZE + wxInt - r.x) * 4;
          if (alpha) {
            image.data[i] = red / alpha;
            image.data[i + 1] = green / alpha;
            image.data[i + 2] = blue / alpha;
            image.data[i + 3] = alpha;
          } else image.data.fill(0, i, i + 4);
        }
      });
      ctx.putImageData(image, 0, 0);
      target.mutateRegion(r, (ctx) => ctx.drawImage(scratch, r.x, r.y));
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
