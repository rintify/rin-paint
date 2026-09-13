import type { StrokePoint } from '../../model';
import { makeCanvas } from '../../engine/layers';
import type { PaintEngine } from '../../engine/PaintEngine';
import type { CanvasLease } from '../../engine/layer-types/types';
import type { Tool } from '../types';

const GLOW_MS = 300;
const GLOW_FILL = 'rgba(90, 180, 255, 0.95)';
const GLOW_SHADOW = 'rgba(70, 160, 255, 0.95)';

interface SelectionGlow {
  silhouette: HTMLCanvasElement;
  startedAt: number;
}

export class CursorTool implements Tool {
  readonly allowsDirectShapeEdit = false;
  private glow: SelectionGlow | null = null;

  constructor(private engine: PaintEngine) {}

  onDown(point: StrokePoint, _event: PointerEvent): void {
    const hit = this.engine.pickLayerAt(point.x, point.y);
    if (!hit) return;
    this.engine.setActiveLayer(hit.layerId);
    this.beginGlow(hit.mask);
  }

  onMove(_point: StrokePoint, _event: PointerEvent): void {}
  onUp(_point: StrokePoint, _event: PointerEvent): void {}

  cancel(): void {
    this.clearGlow();
  }

  overlayAnimated(): boolean {
    return !!this.glow && performance.now() < this.glow.startedAt + GLOW_MS;
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const glow = this.glow;
    if (!glow) return;
    const fade = 1 - (performance.now() - glow.startedAt) / GLOW_MS;
    if (fade <= 0) {
      this.clearGlow();
      return;
    }
    const scale = this.engine.uiScale();
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.shadowColor = GLOW_SHADOW;
    ctx.shadowBlur = 8 * scale;
    ctx.drawImage(glow.silhouette, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = GLOW_FILL;
    ctx.fillRect(0, 0, this.engine.pageFrame.w, this.engine.pageFrame.h);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.shadowBlur = 0;
    ctx.drawImage(glow.silhouette, 0, 0);
    ctx.restore();
  }

  private beginGlow(mask: CanvasLease): void {
    const silhouette = makeCanvas(mask.canvas.width, mask.canvas.height);
    const ctx = silhouette.getContext('2d')!;
    ctx.drawImage(mask.canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, silhouette.width, silhouette.height);
    mask.release();
    this.glow = { silhouette, startedAt: performance.now() };
    this.engine.requestOverlayRender();
  }

  private clearGlow(): void {
    if (!this.glow) return;
    this.glow = null;
    this.engine.requestOverlayRender();
  }
}
