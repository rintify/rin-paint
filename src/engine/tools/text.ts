import type { StrokePoint } from '../../model';
import { normalizeTextToolSettings } from '../../model';
import { newText } from '../text/model';
import type { Tool, ToolContext } from './types';

const HIT_THRESHOLD = 6;
const FRAME_THRESHOLD = 8;

export class TextTool implements Tool {
  private start: StrokePoint | null = null;
  private current: StrokePoint | null = null;
  constructor(private ctx: ToolContext) {}
  onDown(p: StrokePoint): void { this.start = p; this.current = p; }
  onMove(p: StrokePoint): void { this.current = p; }
  onUp(p: StrokePoint): void {
    const start = this.start;
    this.cancel();
    if (!start) return;
    const scale = this.ctx.uiScale();
    const hit = this.ctx.textAt(p.x, p.y);
    if (hit && Math.hypot(p.x - start.x, p.y - start.y) < HIT_THRESHOLD * scale) {
      this.ctx.editTextLayer(hit);
      return;
    }
    const framed =
      Math.abs(p.x - start.x) > FRAME_THRESHOLD * scale &&
      Math.abs(p.y - start.y) > FRAME_THRESHOLD * scale;
    const settings = this.ctx.settings();
    this.ctx.addTextLayer(newText(
      framed ? Math.min(p.x, start.x) : start.x,
      framed ? Math.min(p.y, start.y) : start.y,
      settings?.color ?? '#000',
      framed ? Math.abs(p.x - start.x) : null,
      framed ? Math.abs(p.y - start.y) : null,
      normalizeTextToolSettings(settings?.textSettings),
    ));
  }
  cancel(): void { this.start = this.current = null; }
  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.current) return;
    ctx.save();
    ctx.strokeStyle = '#80bfff';
    ctx.lineWidth = this.ctx.uiScale();
    ctx.strokeRect(this.start.x, this.start.y, this.current.x - this.start.x, this.current.y - this.start.y);
    ctx.restore();
  }
}
