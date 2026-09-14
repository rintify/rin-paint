import { useEffect, useRef } from 'react';
import { useEngine } from '../EngineContext';
import { findLayerModule } from '../../engine/layer-types/registry';
import type { LayerMeta } from '../../model';
import { isLayerType } from '../../model';

export function Thumb({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    const layer = engine.layerById(meta.id);
    if (!layer || !isLayerType(layer.type)) return;
    const view = engine.links.resolvedView(layer);
    const draw = findLayerModule(layer.type)?.definition.renderer.drawThumbnail;
    if (draw) {
      draw(ctx, view as never, {
        width: c.width,
        height: c.height,
        artboard: { w: engine.artboard.w, h: engine.artboard.h },
      });
      return;
    }
    const src = engine.getLayerCanvas(meta.id);
    if (src) ctx.drawImage(src, 0, 0, c.width, c.height);
  }, [engine, meta.id, meta.version, meta.state]);
  return <canvas ref={ref} width={40} height={30} className="thumb" />;
}
