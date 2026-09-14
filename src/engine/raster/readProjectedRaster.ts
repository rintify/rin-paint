import type { RasterSurface } from './RasterSurface';
import type { Homography, RectMm } from '../geometry/homography';
import { warpRegions } from '../geometry/warpRegions';
import { warpCanvas } from '../geometry/warpCanvas';

/** Read a bounded displayed region without resolving a sparse raster's full bounding rectangle. */
export function readProjectedRaster(surface: RasterSurface, nativeToOutput: Homography, region: RectMm): HTMLCanvasElement {
  const result = document.createElement('canvas'); result.width = region.w; result.height = region.h;
  const context = result.getContext('2d')!, output = document.createElement('canvas');
  for (const request of warpRegions(nativeToOutput, region)) {
    const input = surface.read(request.input);
    output.width = request.output.w; output.height = request.output.h;
    warpCanvas(input, output.getContext('2d')!, nativeToOutput, request.input, request.output, output.width, output.height);
    context.drawImage(output, request.output.x - region.x, request.output.y - region.y);
    input.width = input.height = 0;
  }
  output.width = output.height = 0;
  return result;
}
