import type { Homography, RectMm } from '../geometry/homography';
import { warpRegions } from '../geometry/warpRegions';
import { warpCanvas } from '../geometry/warpCanvas';

/** Rasterize a page-space selection only for one occupied native tile. */
export function projectedSelectionMask(region: RectMm, pageToNative: Homography,
  trace: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const mask = document.createElement('canvas'); mask.width = region.w; mask.height = region.h;
  const ctx = mask.getContext('2d')!;
  if (Math.abs(pageToNative[6]) < 1e-12 && Math.abs(pageToNative[7]) < 1e-12) {
    const m = pageToNative.map(value => value / pageToNative[8]);
    ctx.translate(-region.x, -region.y); ctx.transform(m[0], m[3], m[1], m[4], m[2], m[5]);
    trace(ctx); ctx.fill();
    return mask;
  }
  const input = document.createElement('canvas'), output = document.createElement('canvas');
  for (const request of warpRegions(pageToNative, region)) {
    input.width = request.input.w; input.height = request.input.h;
    const source = input.getContext('2d')!; source.translate(-request.input.x, -request.input.y); trace(source); source.fill();
    output.width = request.output.w; output.height = request.output.h;
    warpCanvas(input, output.getContext('2d')!, pageToNative, request.input, request.output, output.width, output.height);
    ctx.drawImage(output, request.output.x - region.x, request.output.y - region.y);
  }
  input.width = input.height = output.width = output.height = 0;
  return mask;
}
