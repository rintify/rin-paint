import type { PaintEngine } from '../PaintEngine';
import type { Layer } from '../layers';

/** Read-only projection shared by drawing, measuring, masks and hit testing. */
export function renderView(engine: PaintEngine, layer: Layer): Layer {
  return engine.links?.resolvedView(layer) ?? layer;
}

export function renderLayerById(engine: PaintEngine, id: string): Layer | null {
  const layer = engine.layerById(id);
  return layer ? renderView(engine, layer) : null;
}
