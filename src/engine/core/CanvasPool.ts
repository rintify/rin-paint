import { makeCanvas } from '../layers';
import type { CanvasLease } from '../layer-types/types';

/** Recursion-safe scratch canvases. A canvas cannot be handed out again until released. */
export class CanvasPool {
  private idle: HTMLCanvasElement[] = [];

  acquire(width: number, height: number): CanvasLease {
    const canvas = this.idle.pop() ?? makeCanvas(width, height);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.clearRect(0, 0, width, height);
    ctx.restore();
    let released = false;
    return {
      canvas,
      ctx,
      release: () => {
        if (released) return;
        released = true;
        this.idle.push(canvas);
      },
    };
  }
}
