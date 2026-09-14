import { RasterAffineRenderer } from './RasterAffineRenderer';
import { RasterTransformPlan } from './RasterTransformPlan';
import { RasterResampler, type RasterPoint } from './RasterResampler';
import { RasterEditSession, RasterSurface } from './RasterSurface';
import {
  tileCoordinates,
  tileKey,
  tileRect,
  type PixelRect,
  type TileKey,
} from './geometry';

/** Display-only sampling at screen resolution. Committing always uses the original pixels. */
export class RasterTransformPreview {
  private signature = '';
  private affine = new RasterAffineRenderer();
  private plan?: RasterTransformPlan;
  private output = new RasterSurface();
  private ready = new Map<TileKey, { tx: number; ty: number }>();
  private reads = new Map<TileKey, Uint8ClampedArray>();

  constructor(
    private source: RasterSurface,
    private sourceRect: PixelRect,
  ) {}

  draw(
    ctx: CanvasRenderingContext2D,
    region: PixelRect,
    corners: readonly RasterPoint[],
    displayScale: number,
  ): void {
    // Quantization keeps the cache stable across small zoom changes and never undersamples the screen.
    const scale = Math.min(
      1,
      2 ** Math.ceil(Math.log2(Math.max(1 / 64, displayScale))),
    );
    const signature = `${scale}:${corners.map((p) => `${p.x},${p.y}`).join(';')}`;
    if (signature !== this.signature) {
      this.signature = signature;
      this.output = new RasterSurface();
      this.ready.clear();
      this.plan = new RasterTransformPlan(
        this.source,
        this.sourceRect,
        corners.map((p) => ({ x: p.x * scale, y: p.y * scale })),
        scale,
      );
    }
    const scaled = corners.map((p) => ({ x: p.x * scale, y: p.y * scale }));
    // One pixel of overlap for bilinear presentation across region boundaries.
    const x = Math.floor(region.x * scale) - 1,
      y = Math.floor(region.y * scale) - 1;
    const request = {
      x,
      y,
      w: Math.ceil((region.x + region.w) * scale) + 1 - x,
      h: Math.ceil((region.y + region.h) * scale) + 1 - y,
    };
    for (const tile of tileCoordinates(request)) {
      const key = tileKey(tile.tx, tile.ty);
      if (!this.ready.has(key)) {
        const edit = new RasterEditSession(this.output);
        RasterResampler.draw(
          this.source,
          this.sourceRect,
          scaled,
          edit,
          tileRect(tile.tx, tile.ty),
          { pixels: this.reads, plan: this.plan, affine: this.affine },
        );
        // Preview tiles are ephemeral; don't scan alpha, publish assets, or create history.
      } else this.ready.delete(key);
      this.ready.set(key, tile);
    }
    ctx.save();
    try {
      ctx.beginPath();
      ctx.rect(region.x, region.y, region.w, region.h);
      ctx.clip();
      ctx.scale(1 / scale, 1 / scale);
      this.output.drawRegion(ctx, request);
    } finally {
      ctx.restore();
    }
    // Keep long pans bounded, including empty tiles remembered by the preview.
    while (this.ready.size > 256) {
      const [key, tile] = this.ready.entries().next().value!;
      this.ready.delete(key);
      this.output.set(tile.tx, tile.ty, null);
    }
  }
}
