import type { StrokePoint } from '../../model';
import type { Tool, ToolContext } from './types';

export class PolygonSplitTool implements Tool {
  private start: StrokePoint | null = null;
  private current: StrokePoint | null = null;

  constructor(private ctx: ToolContext) {}
  onDown(point: StrokePoint): void { this.start = point; this.current = point; }
  onMove(point: StrokePoint): void { if (this.start) { this.current = point; this.ctx.requestRender(); } }
  onUp(point: StrokePoint): void {
    const start = this.start;
    this.start = null; this.current = null;
    if (start && Math.hypot(point.x - start.x, point.y - start.y) > .01) this.ctx.splitPolygons(start, point);
    this.ctx.requestRender();
  }
  cancel(): void { this.start = null; this.current = null; this.ctx.requestRender(); }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.current) return;
    const dx = this.current.x - this.start.x, dy = this.current.y - this.start.y;
    const length = Math.hypot(dx, dy);
    if (length < .01) return;
    const ux = dx / length, uy = dy / length;
    const extent = Math.hypot(this.ctx.artboard.w, this.ctx.artboard.h) * 2;
    const width = this.ctx.settings()?.polygonSplitSettings?.width ?? 0;
    ctx.save();
    ctx.strokeStyle = '#ef5350';
    ctx.lineWidth = Math.max(this.ctx.uiScale(), width);
    ctx.globalAlpha = width > 0 ? .28 : .9;
    ctx.beginPath();
    ctx.moveTo(this.start.x - ux * extent, this.start.y - uy * extent);
    ctx.lineTo(this.start.x + ux * extent, this.start.y + uy * extent);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.25 * this.ctx.uiScale();
    ctx.setLineDash([5 * this.ctx.uiScale(), 4 * this.ctx.uiScale()]);
    ctx.stroke();
    ctx.restore();
  }
}
