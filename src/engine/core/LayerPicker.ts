import { flattenRenderOrder } from '../layerTree';
import { layerHandler } from '../layer-types/registry';
import type { CanvasLease } from '../layer-types/types';
import type { PaintEngine } from '../PaintEngine';

export interface LayerPickHit {
  layerId: string;
  mask: CanvasLease;
}

const HIT_ALPHA_MIN = 1;

export class LayerPicker {
  constructor(private engine: PaintEngine) {}

  pickAt(x: number, y: number): LayerPickHit | null {
    const { w, h } = this.engine.artboard;
    const cx = Math.round(x);
    const cy = Math.round(y);
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return null;
    const layers = this.engine.allLayers();
    const order = flattenRenderOrder(this.engine.getRootLayerIds(), layers);
    const compositor = this.engine.compositor;
    const env = compositor.drawEnv(false);
    for (let index = order.length - 1; index >= 0; index--) {
      const id = order[index]!;
      const layer = this.engine.layerById(id);
      if (!layer?.visible) continue;
      const effect = layerHandler(layer).renderer.effect;
      if (effect && !effect.clickableAddedPixels) continue;
      const padding = Math.max(0, Math.ceil(effect?.paddingPx?.(layer as never, env) ?? 0));
      const region = {
        x: Math.max(0, cx - padding),
        y: Math.max(0, cy - padding),
        w: Math.min(w, cx + padding + 1) - Math.max(0, cx - padding),
        h: Math.min(h, cy + padding + 1) - Math.max(0, cy - padding),
      };
      const sample = compositor.renderLayerHitMask(id, region);
      const alpha = sample.ctx.getImageData(cx - region.x, cy - region.y, 1, 1).data[3];
      sample.release();
      if (alpha < HIT_ALPHA_MIN) continue;
      return { layerId: id, mask: compositor.renderLayerHitMask(id) };
    }
    return null;
  }
}
