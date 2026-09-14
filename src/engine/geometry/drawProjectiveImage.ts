import { multiply, transformBounds, type Homography } from './homography';
import { warpCanvas } from './warpCanvas';

/** Draw through the caller's view transform, clip, opacity and blend mode.
 * Projective output is sampled in bounded device-space tiles, never a world-space bounding box.
 */
export function drawProjectiveImage(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  matrix: Homography,
): void {
  if (Math.abs(matrix[6]) < 1e-12 && Math.abs(matrix[7]) < 1e-12 && Math.abs(matrix[8]) > 1e-12) {
    const m = matrix.map(value => value / matrix[8]);
    ctx.save();
    ctx.transform(m[0], m[3], m[1], m[4], m[2], m[5]);
    ctx.drawImage(source, 0, 0);
    ctx.restore();
    return;
  }
  const view = ctx.getTransform();
  const deviceMatrix = multiply([view.a,view.c,view.e,view.b,view.d,view.f,0,0,1],matrix);
  const extent = transformBounds(deviceMatrix,{x:0,y:0,w:source.width,h:source.height});
  const left = Math.max(0,Math.floor(extent?.x ?? 0));
  const top = Math.max(0,Math.floor(extent?.y ?? 0));
  const right = Math.min(ctx.canvas.width,Math.ceil(extent ? extent.x+extent.w : ctx.canvas.width));
  const bottom = Math.min(ctx.canvas.height,Math.ceil(extent ? extent.y+extent.h : ctx.canvas.height));
  if (right <= left || bottom <= top) return;
  const tile = document.createElement('canvas');
  ctx.save();
  ctx.resetTransform();
  try {
    for (let y=top; y<bottom; y+=256) for (let x=left; x<right; x+=256) {
      tile.width = Math.min(256,right-x);
      tile.height = Math.min(256,bottom-y);
      const target = tile.getContext('2d')!;
      warpCanvas(source,target,deviceMatrix,{x:0,y:0},{x,y},tile.width,tile.height);
      ctx.drawImage(tile,x,y);
    }
  } finally {
    ctx.restore();
    tile.width = tile.height = 0;
  }
}
