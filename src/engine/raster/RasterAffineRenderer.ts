import type { RasterTransformPlan } from './RasterTransformPlan';
import { pointBounds } from './RasterTransformPlan';
import type { RasterSurface, RasterEditSession } from './RasterSurface';
import { intersect, rasterCanvas, type PixelRect } from './geometry';
import { rasterStats } from './RasterMetrics';

/** Native Canvas resampling from a padded source window, with no tile-edge clipping or CPU readback. */
export class RasterAffineRenderer {
  private patch?: HTMLCanvasElement;
  draw(
    source: RasterSurface,
    plan: RasterTransformPlan,
    output: PixelRect,
    target: RasterEditSession,
  ): boolean {
    const m = plan.affine;
    if (!m || Math.abs(m.det) < 1e-12) return false;
    const inverse = (x: number, y: number) => ({
      x: ((x - m.e) * m.d - (y - m.f) * m.c) / m.det,
      y: ((y - m.f) * m.a - (x - m.e) * m.b) / m.det,
    });
    const window = pointBounds(
      [
        inverse(output.x, output.y),
        inverse(output.x + output.w, output.y),
        inverse(output.x + output.w, output.y + output.h),
        inverse(output.x, output.y + output.h),
      ],
      2,
    );
    const content = intersect(window, plan.rect);
    if (!content) return true;
    const input = window;
    // Extreme minification uses the sparse sampler instead of allocating a large input bitmap.
    if (input.w * input.h > 1024 * 1024 || input.w > 2048 || input.h > 2048)
      return false;
    rasterStats.maxTemporaryPixels = Math.max(
      rasterStats.maxTemporaryPixels,
      input.w * input.h,
    );
    const patch = (this.patch ??= rasterCanvas(input.w, input.h));
    if (patch.width !== input.w) patch.width = input.w;
    if (patch.height !== input.h) patch.height = input.h;
    const ctx = patch.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, -input.x, -input.y);
    ctx.clearRect(input.x, input.y, input.w, input.h);
    source.drawRegion(ctx, content);
    target.mutateRegion(output, (dest, tile) => {
      // Keep Canvas coordinates local even for far-away world positions.
      dest.setTransform(
        m.a,
        m.b,
        m.c,
        m.d,
        m.a * input.x + m.c * input.y + m.e - tile.x,
        m.b * input.x + m.d * input.y + m.f - tile.y,
      );
      dest.imageSmoothingEnabled = true;
      dest.imageSmoothingQuality = 'low';
      dest.drawImage(patch, 0, 0);
    });
    rasterStats.nativeTransformedPixels += output.w * output.h;
    return true;
  }
}
