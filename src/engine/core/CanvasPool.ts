import { makeCanvas } from '../layers';
import type { CanvasLease } from '../layer-types/types';

/** Recursion-safe scratch canvases. A canvas cannot be handed out again until released. */
export class CanvasPool {
  private idle: HTMLCanvasElement[] = [];
  private idlePixels = 0;

  constructor(
    private readonly willReadFrequently = false,
    private readonly maxIdle = 4,
    private readonly maxIdlePixels = 2 * 1024 * 1024,
  ) {}

  acquire(width: number, height: number): CanvasLease {
    // 局所dirty矩形の微妙なサイズ差で毎フレーム再確保しない。
    const bucketWidth = Math.max(1, Math.ceil(width / 64) * 64);
    const bucketHeight = Math.max(1, Math.ceil(height / 64) * 64);
    const matching = this.idle.findIndex(canvas => canvas.width === bucketWidth && canvas.height === bucketHeight);
    const reused = matching >= 0 ? this.idle.splice(matching, 1)[0] : this.idle.pop();
    const canvas = reused ?? makeCanvas(bucketWidth, bucketHeight);
    if (reused) this.idlePixels -= canvas.width * canvas.height;
    if (canvas.width !== bucketWidth || canvas.height !== bucketHeight) {
      canvas.width = bucketWidth;
      canvas.height = bucketHeight;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: this.willReadFrequently })!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    // backing store は64px単位なので、論理領域外に前回の画素を残さない。
    ctx.clearRect(0, 0, bucketWidth, bucketHeight);
    ctx.restore();
    let released = false;
    return {
      canvas,
      ctx,
      release: () => {
        if (released) return;
        released = true;
        this.idle.push(canvas);
        this.idlePixels += canvas.width * canvas.height;
        while (this.idle.length > this.maxIdle || this.idlePixels > this.maxIdlePixels) {
          const discarded = this.idle.shift();
          if (!discarded) break;
          this.idlePixels -= discarded.width * discarded.height;
          discarded.width = 0;
          discarded.height = 0;
        }
      },
    };
  }

  clear(): void {
    for (const canvas of this.idle) {
      canvas.width = 0;
      canvas.height = 0;
    }
    this.idle = [];
    this.idlePixels = 0;
  }
}
