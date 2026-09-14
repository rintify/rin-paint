import {composeCanvasTransform} from './canvasPrecision';
import {multiply, transformBounds, type Homography, type RectMm} from './homography';
import {warpRegions} from './warpRegions';
import {warpCanvas} from './warpCanvas';

/** Render vector/text procedures through a homography using bounded source and output tiles. */
export function drawProjectedProcedure(ctx: CanvasRenderingContext2D, bounds: RectMm | null, matrix: Homography,
  draw: (source: CanvasRenderingContext2D) => void): void {
  if (Math.abs(matrix[6]) < 1e-12 && Math.abs(matrix[7]) < 1e-12) {
    const m = matrix.map(value => value / matrix[8]);
    ctx.save(); composeCanvasTransform(ctx,m[0],m[3],m[1],m[4],m[2],m[5]); draw(ctx); ctx.restore(); return;
  }
  const view = ctx.getTransform();
  const device = multiply([view.a, view.c, view.e, view.b, view.d, view.f, 0, 0, 1], matrix);
  const extent = bounds && transformBounds(device, bounds);
  const x = Math.max(0, Math.floor(extent?.x ?? 0)), y = Math.max(0, Math.floor(extent?.y ?? 0));
  const right = Math.min(ctx.canvas.width, Math.ceil(extent ? extent.x + extent.w : ctx.canvas.width));
  const bottom = Math.min(ctx.canvas.height, Math.ceil(extent ? extent.y + extent.h : ctx.canvas.height));
  if (right <= x || bottom <= y) return;
  const input = document.createElement('canvas'), output = document.createElement('canvas');
  ctx.save(); ctx.resetTransform();
  try {
    for (const request of warpRegions(device, {x, y, w: right - x, h: bottom - y})) {
      input.width = request.input.w; input.height = request.input.h;
      const source = input.getContext('2d')!; source.translate(-request.input.x, -request.input.y); draw(source);
      output.width = request.output.w; output.height = request.output.h;
      warpCanvas(input, output.getContext('2d')!, device, request.input, request.output, output.width, output.height);
      ctx.drawImage(output, request.output.x, request.output.y);
    }
  } finally {ctx.restore(); input.width = input.height = output.width = output.height = 0;}
}
