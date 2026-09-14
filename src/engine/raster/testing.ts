import type { RasterLayer } from '../layers';
import { RasterEditSession } from './RasterSurface';
import type { PixelRect } from './geometry';
/** Fixture utility: all test writes follow the same mutation contract as tools. */
export function paintRaster(
  layer: RasterLayer,
  paint: (ctx: CanvasRenderingContext2D) => void,
  rect: PixelRect = { x: 0, y: 0, w: 256, h: 256 },
): void {
  const edit = new RasterEditSession(layer.runtime.surface);
  edit.mutateRegion(rect, paint);
  edit.commit();
}
