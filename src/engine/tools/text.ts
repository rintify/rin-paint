import type { StrokePoint } from '../../types';
import type { PaintEngine } from '../PaintEngine';
import type { Tool } from './types';
import { useStore } from '../../state/store';
import { newText } from '../text/model';
import { normalizeTextToolSettings } from '../../types';

export class TextTool implements Tool {
  private start: StrokePoint | null = null;
  private current: StrokePoint | null = null;
  constructor(private engine: PaintEngine) {}
  onDown(p: StrokePoint): void { this.start = p; this.current = p; }
  onMove(p: StrokePoint): void { this.current = p; }
  onUp(p: StrokePoint): void {
    const start = this.start;
    this.cancel();
    if (!start) return;
    const hit = this.engine.textAt(p.x, p.y);
    if (hit && Math.hypot(p.x - start.x, p.y - start.y) < 6 * this.engine.uiScale()) { this.engine.editTextLayer(hit); return; }
    const framed = Math.abs(p.x - start.x) > 8 * this.engine.uiScale() && Math.abs(p.y - start.y) > 8 * this.engine.uiScale();
    const state = useStore.getState();
    const active = state.tools.find(tool => tool.id === state.activeToolId);
    this.engine.addTextLayer(newText(
      framed ? Math.min(p.x, start.x) : start.x,
      framed ? Math.min(p.y, start.y) : start.y,
      state.penColor,
      framed ? Math.abs(p.x - start.x) : null,
      framed ? Math.abs(p.y - start.y) : null,
      normalizeTextToolSettings(active?.textSettings),
    ));
  }
  cancel(): void { this.start = this.current = null; }
  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.current) return;
    ctx.save(); ctx.strokeStyle = '#80bfff'; ctx.lineWidth = this.engine.uiScale();
    ctx.strokeRect(this.start.x, this.start.y, this.current.x - this.start.x, this.current.y - this.start.y); ctx.restore();
  }
}
