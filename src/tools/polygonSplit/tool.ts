import type { StrokePoint } from '../../model';
import type { PaintEngine } from '../../engine/PaintEngine';
import { mmToPx } from '../../engine/units';
import type { Tool } from '../types';
import { normalizePolygonSplitToolSettings } from './settings';

export class PolygonSplitTool implements Tool {
  readonly allowsDirectShapeEdit = false;
  private start: StrokePoint | null = null;
  private current: StrokePoint | null = null;

  constructor(private eng: PaintEngine) {}

  onDown(point: StrokePoint): void {
    this.start = point;
    this.current = point;
  }

  onMove(point: StrokePoint): void {
    if (this.start) {
      this.current = point;
      this.eng.requestOverlayRender();
    }
  }

  onUp(point: StrokePoint): void {
    const start = this.start;
    this.start = null;
    this.current = null;
    if (start && Math.hypot(point.x - start.x, point.y - start.y) > 0.01) {
      void this.eng.polygonSplit.split(start, point);
    }
    this.eng.requestOverlayRender();
  }

  cancel(): void {
    this.start = null;
    this.current = null;
    this.eng.requestOverlayRender();
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.current) return;
    const dx = this.current.x - this.start.x;
    const dy = this.current.y - this.start.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.01) return;
    const ux = dx / length;
    const uy = dy / length;
    const extent = Math.hypot(this.eng.artboard.w, this.eng.artboard.h) * 2;
    const widthMm = normalizePolygonSplitToolSettings(this.eng.activeToolSettings()?.settings).widthMm;
    const width = mmToPx(widthMm, this.eng.getPageSpec().ppi);
    ctx.save();
    ctx.strokeStyle = '#ef5350';
    ctx.lineWidth = Math.max(this.eng.uiScale(), width);
    ctx.globalAlpha = width > 0 ? 0.28 : 0.9;
    ctx.beginPath();
    ctx.moveTo(this.start.x - ux * extent, this.start.y - uy * extent);
    ctx.lineTo(this.start.x + ux * extent, this.start.y + uy * extent);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.25 * this.eng.uiScale();
    ctx.setLineDash([5 * this.eng.uiScale(), 4 * this.eng.uiScale()]);
    ctx.stroke();
    ctx.restore();
  }
}
