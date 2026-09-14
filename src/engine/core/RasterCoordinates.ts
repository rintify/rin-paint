import type { PaintEngine } from '../PaintEngine';
import type { RasterLayer } from '../layers';
import { inverse, multiply, scaling, translation, type Homography } from '../geometry/homography';
import { ScopeTransforms } from './ScopeTransforms';

/** Shared native-pixel ↔ displayed-page mapping, including operators outside a canvas. */
export function rasterToPage(engine: PaintEngine, layer: RasterLayer): Homography {
  const ppi = engine.getPageSpec().ppi;
  const placement = rasterToScope(layer, ppi);
  const scopes = new ScopeTransforms(engine.getRootLayerIds(), engine.allLayers(), ppi);
  return multiply(scopes.layerToPage(layer.id), placement);
}

export function pageToRaster(engine: PaintEngine, layer: RasterLayer): Homography | null {
  return inverse(rasterToPage(engine, layer));
}

/** Native raster pixels to the containing scope's output pixels. */
export function rasterToScope(layer: RasterLayer, ppi: number): Homography {
  const surface = layer.runtime.surface;
  return multiply(scaling(ppi / 25.4), multiply(layer.state.matrix,
    multiply(translation(surface.originMm.x, surface.originMm.y), scaling(25.4 / surface.intrinsicPpi))));
}
