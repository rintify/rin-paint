import {finiteProjection} from '../geometry/finiteProjection';
import {inverse, transformBounds, type Homography, type RectMm} from '../geometry/homography';
import {warpRegions} from '../geometry/warpRegions';
import {warpCanvas} from '../geometry/warpCanvas';
import type {RasterSurface} from './RasterSurface';

/** Rasterize only occupied source regions into native destination tiles. */
export function paintProjectedDrawing(
  surface: RasterSurface, regions: Iterable<RectMm>, matrix: Homography,
  draw: (ctx: CanvasRenderingContext2D, sourceRegion: RectMm) => void,
  opacity = 1, blend: GlobalCompositeOperation = 'source-over',
): void {
  const inv = inverse(matrix); if (!inv) return;
  const destinations = new Set<string>();
  for (const source of regions) {
    for (const bounds of finiteProjection(matrix,source)) for (let y = Math.floor(bounds.y / 256); y < Math.ceil((bounds.y + bounds.h) / 256); y++) {
      for (let x = Math.floor(bounds.x / 256); x < Math.ceil((bounds.x + bounds.w) / 256); x++) destinations.add(`${x},${y}`);
    }
  }
  for (const key of destinations) {
    const [x, y] = key.split(',').map(Number), region = {x: x * 256, y: y * 256, w: 256, h: 256};
    surface.paint(region, ctx => {
      ctx.globalAlpha = opacity; ctx.globalCompositeOperation = blend;
      if (Math.abs(matrix[6]) < 1e-12 && Math.abs(matrix[7]) < 1e-12) {
        const input = transformBounds(inv, region); if (!input) return;
        const m = matrix.map(value => value / matrix[8]);
        ctx.transform(m[0], m[3], m[1], m[4], m[2], m[5]); draw(ctx, input); return;
      }
      const input = document.createElement('canvas'), output = document.createElement('canvas');
      for (const request of warpRegions(matrix, region)) {
        input.width = request.input.w; input.height = request.input.h;
        const source = input.getContext('2d')!; source.translate(-request.input.x, -request.input.y);
        draw(source, request.input);
        output.width = request.output.w; output.height = request.output.h;
        warpCanvas(input, output.getContext('2d')!, matrix, request.input, request.output, output.width, output.height);
        ctx.drawImage(output, request.output.x, request.output.y);
      }
      input.width = input.height = output.width = output.height = 0;
    });
  }
}
