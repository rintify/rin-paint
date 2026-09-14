import { RasterWarpMesh } from './RasterWarpMesh';
import type { RasterPoint } from './RasterResampler';
import type { RasterSurface } from './RasterSurface';
import {
  intersect,
  tileCoordinates,
  tileKey,
  TILE_SIZE,
  validateRect,
  type PixelRect,
  type TileKey,
} from './geometry';

export function pointBounds(
  points: readonly RasterPoint[],
  pad = 0,
): PixelRect {
  const x = Math.floor(Math.min(...points.map((p) => p.x)) - pad),
    y = Math.floor(Math.min(...points.map((p) => p.y)) - pad);
  return {
    x,
    y,
    w: Math.ceil(Math.max(...points.map((p) => p.x)) + pad) - x,
    h: Math.ceil(Math.max(...points.map((p) => p.y)) + pad) - y,
  };
}
export interface AffineMap {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  det: number;
}

/** Geometry is prepared once per transform, not again for every output tile. */
export class RasterTransformPlan {
  readonly bounds: PixelRect;
  readonly mesh: RasterWarpMesh;
  readonly affine: AffineMap | null;
  private regions: PixelRect[] = [];
  constructor(
    source: RasterSurface,
    readonly rect: PixelRect,
    readonly corners: readonly RasterPoint[],
    pixelScale = 1,
  ) {
    if (corners.length !== 4) throw new Error('変形の四隅が不正です');
    this.bounds = pointBounds(corners, 2);
    validateRect(this.bounds);
    this.mesh = new RasterWarpMesh(corners, pixelScale);
    const [p, q, , s] = corners;
    const a = (q.x - p.x) / rect.w,
      b = (q.y - p.y) / rect.w,
      c = (s.x - p.x) / rect.h,
      d = (s.y - p.y) / rect.h;
    this.affine =
      this.mesh.divisions === 1
        ? {
            a,
            b,
            c,
            d,
            e: p.x - a * rect.x - c * rect.y,
            f: p.y - b * rect.x - d * rect.y,
            det: a * d - b * c,
          }
        : null;
    for (const t of source.entries()) {
      const r = intersect(
        {
          x: t.tx * TILE_SIZE + t.asset.bounds.x - 1,
          y: t.ty * TILE_SIZE + t.asset.bounds.y - 1,
          w: t.asset.bounds.w + 2,
          h: t.asset.bounds.h + 2,
        },
        rect,
      );
      if (!r) continue;
      const points = this.mesh.regionPoints(
        (r.x - rect.x) / rect.w,
        (r.y - rect.y) / rect.h,
        (r.x + r.w - rect.x) / rect.w,
        (r.y + r.h - rect.y) / rect.h,
      );
      this.regions.push(pointBounds(points, 2));
    }
  }
  candidates(clip?: PixelRect): Iterable<{ tx: number; ty: number }> {
    const tiles = new Map<TileKey, { tx: number; ty: number }>();
    for (const r of this.regions) {
      const area = clip ? intersect(r, clip) : r;
      if (!area) continue;
      for (const t of tileCoordinates(area)) tiles.set(tileKey(t.tx, t.ty), t);
    }
    return tiles.values();
  }
}
