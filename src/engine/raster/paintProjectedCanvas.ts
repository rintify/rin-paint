import {finiteProjection} from '../geometry/finiteProjection';
import { drawProjectiveImage } from '../geometry/drawProjectiveImage';
import { type Homography } from '../geometry/homography';
import type { RasterSurface } from './RasterSurface';

/** Paint only destination tiles reached by nontransparent source tiles. */
export function paintProjectedCanvas(surface: RasterSurface, source: HTMLCanvasElement, matrix: Homography,
  composite: GlobalCompositeOperation = 'source-over'): void {
  const keys = new Set<string>();
  const read = source.getContext('2d', {willReadFrequently: true})!;
  for (let y = 0; y < source.height; y += 256) for (let x = 0; x < source.width; x += 256) {
    const w = Math.min(256, source.width - x), h = Math.min(256, source.height - y);
    const pixels = read.getImageData(x, y, w, h).data;
    let occupied = false;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) {occupied = true; break;}
    if (!occupied) continue;
    for (const extent of finiteProjection(matrix,{x,y,w,h})) for (let ty = Math.floor(extent.y / 256); ty < Math.ceil((extent.y + extent.h) / 256); ty++) {
      for (let tx = Math.floor(extent.x / 256); tx < Math.ceil((extent.x + extent.w) / 256); tx++) keys.add(`${tx},${ty}`);
    }
  }
  for (const key of keys) {
    const [x, y] = key.split(',').map(Number);
    surface.paint({x: x * 256, y: y * 256, w: 256, h: 256}, ctx => {
      ctx.globalCompositeOperation = composite;
      drawProjectiveImage(ctx, source, matrix);
    });
  }
}
