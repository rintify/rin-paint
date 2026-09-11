import { addFrame, thinFramesIfNeeded } from '../persistence/db';
import type { PaintEngine } from '../PaintEngine';

const FRAME_LONG_SIDE = 960;
const MAX_FRAMES = 3000;
const CAPTURE_DELAY_MS = 400;

/**
 * 確定操作のあとにだけ合成結果を縮小 JPEG で記録する。
 * undo/redo では schedule が呼ばれないため「戻る」は動画に残らない。
 */
export class TimelapseRecorder {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private capturing = false;
  private generation = 0;
  private task: Promise<void> = Promise.resolve();

  constructor(
    private engine: PaintEngine,
    private onStored: () => void,
  ) {}

  schedule(): void {
    if (!this.engine.isTimelapseEnabled()) return;
    this.cancelPending();
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.task = this.capture(generation);
    }, CAPTURE_DELAY_MS);
  }

  setEnabled(enabled: boolean): void {
    this.generation++;
    if (!enabled) this.cancelPending();
  }

  /** 直前の確定操作に対する保留中の記録を破棄 */
  cancelPending(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async reset(): Promise<void> {
    this.generation++;
    this.cancelPending();
    await this.task;
  }

  private async capture(generation: number): Promise<void> {
    if (this.capturing) return;
    this.capturing = true;
    try {
      await this.engine.readyToRender();
      if (generation !== this.generation) return;
      const src = this.engine.compositeCanvas();
      if (!src) return;
      this.engine.ensureComposited();
      const scale = FRAME_LONG_SIDE / Math.max(src.width, src.height);
      const c = document.createElement('canvas');
      c.width = Math.round(src.width * scale);
      c.height = Math.round(src.height * scale);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(src, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        c.toBlob(resolve, 'image/jpeg', 0.72),
      );
      if (
        !blob ||
        generation !== this.generation ||
        !this.engine.isTimelapseEnabled()
      ) return;
      await addFrame({ t: Date.now(), blob });
      await thinFramesIfNeeded(MAX_FRAMES);
      this.onStored();
    } catch {
      // 記録失敗は描画動作に影響させない
    } finally {
      this.capturing = false;
    }
  }
}
