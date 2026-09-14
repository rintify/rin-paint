import {
  RasterEditSession,
  type RasterChangeSet,
} from '../raster/RasterSurface';
import {
  tileCoordinates,
  yieldRaster,
  tileKey,
  tileRect,
  TILE_SIZE,
  type PixelRect,
} from '../raster/geometry';
import { layerHandler } from '../layer-types/registry';
import type { Layer, RasterLayer } from '../layers';
import type { PaintEngine } from '../PaintEngine';
/** Produces all tile changes before the caller removes a source or changes tree metadata. */
export class RasterBakeService {
  constructor(private engine: PaintEngine) {}
  bake(target: RasterLayer, source: Layer): RasterChangeSet {
    const work = this.steps(target, source);
    let result = work.next();
    while (!result.done) result = work.next();
    return result.value;
  }
  async bakeAsync(
    target: RasterLayer,
    source: Layer,
  ): Promise<RasterChangeSet> {
    const work = this.steps(target, source);
    let result = work.next(),
      count = 0;
    while (!result.done) {
      if (++count % 4 === 0) await yieldRaster();
      result = work.next();
    }
    return result.value;
  }
  private *steps(
    target: RasterLayer,
    source: Layer,
  ): Generator<void, RasterChangeSet> {
    const compositor = this.engine.compositor,
      handler = layerHandler(source),
      effect = handler.renderer.effect;
    const edit = new RasterEditSession(target.runtime.surface),
      original = target.runtime.surface.clone();
    const candidates = new Map<string, { tx: number; ty: number }>();
    const pad = Math.ceil(
      effect?.paddingPx?.(source as never, compositor.drawEnv(false)) ?? 0,
    );
    const add = (r: PixelRect) => {
      for (const t of tileCoordinates(r))
        candidates.set(tileKey(t.tx, t.ty), t);
    };
    if (effect || source.type === 'raster') {
      const surface =
        source.type === 'raster' && !effect ? source.runtime.surface : original;
      for (const t of surface.entries())
        add({
          x: t.tx * TILE_SIZE - pad,
          y: t.ty * TILE_SIZE - pad,
          w: TILE_SIZE + pad * 2,
          h: TILE_SIZE + pad * 2,
        });
    } else {
      const bounds =
        source.type === 'shape' &&
        'paintMode' in source.state.shape &&
        source.state.shape.paintMode === 'fill-outside'
          ? { x: 0, y: 0, w: this.engine.artboard.w, h: this.engine.artboard.h }
          : compositor.contentBounds(source);
      if (bounds) add(bounds);
    }
    try {
      for (const { tx, ty } of candidates.values()) {
        const out = tileRect(tx, ty),
          input = {
            x: out.x - pad,
            y: out.y - pad,
            w: out.w + pad * 2,
            h: out.h + pad * 2,
          };
        const env = compositor.drawEnv(
            false,
            input.w,
            input.h,
            input.x,
            input.y,
          ),
          work = env.borrowCanvas(input.w, input.h);
        try {
          if (effect) {
            work.ctx.translate(-input.x, -input.y);
            work.ctx.globalAlpha = target.visible ? target.opacity : 0;
            work.ctx.globalCompositeOperation = target.blend;
            original.drawRegion(work.ctx, input);
            work.ctx.setTransform(1, 0, 0, 1, 0, 0);
            work.ctx.globalAlpha = 1;
            work.ctx.globalCompositeOperation = 'source-over';
            effect.apply(
              {
                canvas: work.canvas,
                coverage: work.canvas,
                x: input.x,
                y: input.y,
                width: input.w,
                height: input.h,
                inputRevision: this.engine.getRenderRevision(target.id),
              },
              source as never,
              env,
            );
            edit.mutateRegion(out, (ctx) => {
              ctx.clearRect(out.x, out.y, out.w, out.h);
              ctx.drawImage(
                work.canvas,
                pad,
                pad,
                out.w,
                out.h,
                out.x,
                out.y,
                out.w,
                out.h,
              );
            });
          } else {
            // Render into the destination tile with the original blend backdrop.
            work.ctx.translate(-input.x, -input.y);
            original.drawRegion(work.ctx, input);
            handler.renderer.draw(work.ctx, source as never, env);
            edit.mutateRegion(out, (ctx) => {
              ctx.clearRect(out.x, out.y, out.w, out.h);
              ctx.drawImage(
                work.canvas,
                0,
                0,
                out.w,
                out.h,
                out.x,
                out.y,
                out.w,
                out.h,
              );
            });
          }
        } finally {
          work.release();
        }
        yield;
      }
      return edit.commit();
    } catch (error) {
      edit.cancel();
      throw error;
    }
  }
}
