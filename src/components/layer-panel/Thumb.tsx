import { useEffect, useRef } from 'react';
import { useEngine } from '../EngineContext';
import { drawShape } from '../../engine/shapes';
import type { LayerMeta } from '../../model';

export function Thumb({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    const src = engine.getLayerCanvas(meta.id);
    if (src) ctx.drawImage(src, 0, 0, c.width, c.height);
    else if (meta.shape) {
      ctx.save();
      ctx.scale(c.width / engine.artboard.w, c.height / engine.artboard.h);
      drawShape(ctx, meta.shape, false);
      ctx.restore();
    }
  }, [engine, meta.id, meta.version, meta.shape]);
  return <canvas ref={ref} width={40} height={30} className="thumb" />;
}
