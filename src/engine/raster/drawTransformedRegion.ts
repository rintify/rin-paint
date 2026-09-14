import { intersect, rasterCanvas, type PixelRect } from './geometry';
import { rasterStats } from './RasterMetrics';

/** Join source tiles before filtering, and partition only on integer destination pixels. */
export function drawTransformedRegion(
  target: CanvasRenderingContext2D,
  region: PixelRect,
  drawTiles: (ctx: CanvasRenderingContext2D, region: PixelRect) => void,
): void {
  const m = target.getTransform();
  const det = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return;
  const inverse = (x: number, y: number) => ({
    x: ((x - m.e) * m.d - (y - m.f) * m.c) / det,
    y: ((y - m.f) * m.a - (x - m.e) * m.b) / det,
  });
  const bounds = (
    rect: PixelRect,
    map: (x: number, y: number) => { x: number; y: number },
    pad = 0,
  ): PixelRect => {
    const points = [
      map(rect.x, rect.y),
      map(rect.x + rect.w, rect.y),
      map(rect.x, rect.y + rect.h),
      map(rect.x + rect.w, rect.y + rect.h),
    ];
    const x = Math.floor(Math.min(...points.map(p => p.x))) - pad;
    const y = Math.floor(Math.min(...points.map(p => p.y))) - pad;
    return {
      x, y,
      w: Math.ceil(Math.max(...points.map(p => p.x))) + pad - x,
      h: Math.ceil(Math.max(...points.map(p => p.y))) + pad - y,
    };
  };
  const output = intersect(
    bounds(region, (x, y) => ({
      x: m.a * x + m.c * y + m.e,
      y: m.b * x + m.d * y + m.f,
    })),
    { x: 0, y: 0, w: target.canvas.width, h: target.canvas.height },
  );
  if (!output) return;

  // Limit scratch memory during zooming and panning, even on a large document.
  const inverseSpan = Math.max(
    (Math.abs(m.d) + Math.abs(m.c)) / Math.abs(det),
    (Math.abs(m.b) + Math.abs(m.a)) / Math.abs(det),
  );
  const step = Math.max(1, Math.min(512, Math.floor(1024 / inverseSpan)));
  const patch = rasterCanvas(1, 1);
  for (let y = output.y; y < output.y + output.h; y += step) {
    for (let x = output.x; x < output.x + output.w; x += step) {
      const block = {
        x, y,
        w: Math.min(step, output.x + output.w - x),
        h: Math.min(step, output.y + output.h - y),
      };
      // Neighbour pixels provide the filtering halo; the destination clip owns the edges.
      const input = intersect(bounds(block, inverse, 2), {
        x: Math.floor(region.x) - 2,
        y: Math.floor(region.y) - 2,
        w: Math.ceil(region.x + region.w) - Math.floor(region.x) + 4,
        h: Math.ceil(region.y + region.h) - Math.floor(region.y) + 4,
      });
      if (!input) continue;
      rasterStats.maxTemporaryPixels = Math.max(
        rasterStats.maxTemporaryPixels,
        input.w * input.h,
      );
      if (patch.width !== input.w) patch.width = input.w;
      if (patch.height !== input.h) patch.height = input.h;
      const ctx = patch.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, patch.width, patch.height);
      ctx.translate(-input.x, -input.y);
      drawTiles(ctx, input);
      target.save();
      try {
        target.setTransform(1, 0, 0, 1, 0, 0);
        target.beginPath();
        target.rect(block.x, block.y, block.w, block.h);
        target.clip();
        target.setTransform(
          m.a, m.b, m.c, m.d,
          m.a * input.x + m.c * input.y + m.e,
          m.b * input.x + m.d * input.y + m.f,
        );
        target.drawImage(patch, 0, 0);
      } finally {
        target.restore();
      }
    }
  }
}
