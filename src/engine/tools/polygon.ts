import type { ShapePoint, StrokePoint } from '../../model';
import {
  drawShape,
  polygonFromWorldPoints,
  polygonSelfIntersects,
  segmentsIntersect,
} from '../shapes';
import type { Tool, ToolContext, ToolSession } from './types';

function openEdgeIntersects(points: ShapePoint[], next: ShapePoint): boolean {
  if (points.length < 2) return false;
  const a = points.at(-1)!;
  for (let i = 0; i < points.length - 2; i++) {
    if (segmentsIntersect(a, next, points[i], points[i + 1])) return true;
  }
  return false;
}

export class PolygonTool implements Tool {
  private points: ShapePoint[] = [];
  private cursor: ShapePoint | null = null;

  readonly session: ToolSession = {
    active: () => this.points.length > 0,
    commit: () => this.commit(),
    cancel: () => this.cancel(),
  };

  constructor(private ctx: ToolContext) {}

  onDown(p: StrokePoint): void {
    this.cursor = { x: p.x, y: p.y };
  }

  onMove(p: StrokePoint): void {
    this.cursor = { x: p.x, y: p.y };
    this.ctx.requestRender();
  }

  onUp(p: StrokePoint): void {
    const next = { x: p.x, y: p.y };
    const closeRadius = 11 * this.ctx.uiScale();
    if (this.points.length >= 3 && Math.hypot(next.x - this.points[0].x, next.y - this.points[0].y) <= closeRadius) {
      this.commit();
      return;
    }
    if (this.points.some(point => Math.hypot(next.x - point.x, next.y - point.y) < .01)
      || openEdgeIntersects(this.points, next)) {
      this.ctx.notify('自己交差する頂点は追加できません');
      this.ctx.requestRender();
      return;
    }
    this.points.push(next);
    this.cursor = null;
    this.syncUi();
    this.ctx.requestRender();
  }

  undoPoint(): void {
    this.points.pop();
    if (!this.points.length) this.cursor = null;
    this.syncUi();
    this.ctx.requestRender();
  }

  commit(): void {
    if (this.points.length < 3) return;
    if (polygonSelfIntersects(this.points)) {
      this.ctx.notify('自己交差する多角形は確定できません');
      return;
    }
    const settings = this.ctx.settings();
    const shape = polygonFromWorldPoints(this.points, {
      color: settings?.color ?? '#000000',
      strokeWidth: settings?.size ?? 14,
      paintMode: settings?.shapeSettings?.paintMode ?? 'stroke',
    });
    this.points = [];
    this.cursor = null;
    this.syncUi();
    this.ctx.addShapeLayer(shape);
  }

  cancel(): void {
    this.points = [];
    this.cursor = null;
    this.syncUi();
    this.ctx.requestRender();
  }

  private syncUi(): void {
    this.ctx.setPolygonDraftState({ active: this.points.length > 0, pointCount: this.points.length });
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.points.length) return;
    const settings = this.ctx.settings();
    const cursor = this.cursor;
    const candidate = cursor ? [...this.points, cursor] : [...this.points];
    const invalid = !!cursor && openEdgeIntersects(this.points, cursor)
      || candidate.length >= 3 && polygonSelfIntersects(candidate);
    ctx.save();
    ctx.strokeStyle = invalid ? '#e53935' : '#4f8cff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 1.5 * this.ctx.uiScale();
    ctx.setLineDash([4 * this.ctx.uiScale(), 3 * this.ctx.uiScale()]);
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) ctx.lineTo(this.points[i].x, this.points[i].y);
    if (cursor) ctx.lineTo(cursor.x, cursor.y);
    if (candidate.length >= 3) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    for (const point of this.points) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4 * this.ctx.uiScale(), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (candidate.length >= 3 && !invalid) {
      const preview = polygonFromWorldPoints(candidate, {
        color: settings?.color === 'transparent' ? '#aaaaaa' : settings?.color ?? '#000',
        strokeWidth: settings?.size ?? 14,
        paintMode: settings?.shapeSettings?.paintMode ?? 'stroke',
      });
      ctx.globalAlpha = .22;
      drawShape(ctx, preview, false, this.ctx.artboard);
    }
    ctx.restore();
  }
}
