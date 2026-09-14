import { useEffect, useRef } from 'react';
import { useEngine } from '../EngineContext';
import { drawShape } from '../../engine/shapes';
import type { LayerMeta } from '../../model';

export function Thumb({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const ref = useRef<HTMLCanvasElement>(null);
  const imageSource =
    meta.type === 'image' ? engine.getLayerCanvas(meta.id) : null;
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    const src = imageSource ?? engine.getLayerCanvas(meta.id);
    if (meta.type === 'raster') {
      const layer = engine.layerById(meta.id);
      if (layer?.type === 'raster') {
        ctx.save();
        ctx.scale(c.width / engine.artboard.w, c.height / engine.artboard.h);
        layer.runtime.surface.drawRegion(ctx, {
          x: 0,
          y: 0,
          w: engine.artboard.w,
          h: engine.artboard.h,
        });
        ctx.restore();
      }
    } else if (src) ctx.drawImage(src, 0, 0, c.width, c.height);
    else if (meta.type === 'shape') {
      ctx.save();
      ctx.scale(c.width / engine.artboard.w, c.height / engine.artboard.h);
      drawShape(ctx, meta.state.shape, false, engine.artboard);
      ctx.restore();
    }
  }, [
    engine,
    meta.id,
    meta.type === 'image' ? imageSource : meta.version,
    meta.type === 'shape' ? meta.state.shape : null,
  ]);
  return <canvas ref={ref} width={40} height={30} className="thumb" />;
}
