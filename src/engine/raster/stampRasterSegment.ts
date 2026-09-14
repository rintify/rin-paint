import {composeCanvasTransform} from '../geometry/canvasPrecision';
import {finiteProjection} from '../geometry/finiteProjection';
import { IDENTITY, type Homography } from '../geometry/homography';
import { warpRegions } from '../geometry/warpRegions';
import { warpCanvas } from '../geometry/warpCanvas';
import { stampSegment } from '../brush';
import type { RasterLayer } from '../layers';

/** Enumerate tiles along the stroke instead of allocating the segment's bounding rectangle. */
export function stampRasterSegment(layer: RasterLayer, ax: number, ay: number, ar: number, bx: number, by: number, br: number, color: string, erase: boolean, pageToNative: Homography = IDENTITY): void {
  const count = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 128));
  const keys = new Set<string>();
  for (let i = 0; i < count; i++) {
    const a = i / count, b = (i + 1) / count;
    const x0 = ax + (bx - ax) * a, y0 = ay + (by - ay) * a;
    const x1 = ax + (bx - ax) * b, y1 = ay + (by - ay) * b;
    const radius = Math.max(ar + (br - ar) * a, ar + (br - ar) * b) + 2;
    const extents = finiteProjection(pageToNative, {x: Math.min(x0, x1) - radius, y: Math.min(y0, y1) - radius,
      w: Math.abs(x1 - x0) + radius * 2, h: Math.abs(y1 - y0) + radius * 2});
    for (const extent of extents) for (let y = Math.floor(extent.y / 256); y <= Math.floor((extent.y + extent.h) / 256); y++) {
      for (let x = Math.floor(extent.x / 256); x <= Math.floor((extent.x + extent.w) / 256); x++) keys.add(`${x},${y}`);
    }
  }
  for (const key of keys) {
    const [x, y] = key.split(',').map(Number);
    const region = {x: x * 256, y: y * 256, w: 256, h: 256};
    layer.runtime.surface.paint(region, ctx => {
      if (Math.abs(pageToNative[6]) < 1e-12 && Math.abs(pageToNative[7]) < 1e-12) {
        const m = pageToNative.map(value => value / pageToNative[8]);
        composeCanvasTransform(ctx,m[0],m[3],m[1],m[4],m[0]*ax+m[1]*ay+m[2],m[3]*ax+m[4]*ay+m[5]);
        stampSegment(ctx,0,0,ar,bx-ax,by-ay,br,color,erase);
        return;
      }
      const input = document.createElement('canvas'), output = document.createElement('canvas');
      ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
      for (const request of warpRegions(pageToNative, region)) {
        input.width = request.input.w; input.height = request.input.h;
        const source = input.getContext('2d')!;
        source.translate(ax-request.input.x,ay-request.input.y);
        stampSegment(source,0,0,ar,bx-ax,by-ay,br,erase ? '#000' : color,false);
        output.width = request.output.w; output.height = request.output.h;
        warpCanvas(input, output.getContext('2d')!, pageToNative, request.input, request.output, output.width, output.height);
        ctx.drawImage(output, request.output.x, request.output.y);
      }
      input.width = input.height = output.width = output.height = 0;
    });
  }
}
