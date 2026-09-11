import { TRANSPARENT, type ShapePoint, type StrokePoint } from '../../model';
import {
  drawShape,
  polygonFromWorldPoints,
  polygonSelfIntersects,
  segmentsIntersect,
} from '../../engine/shapes';
import type { PaintEngine } from '../../engine/PaintEngine';
import { DEFAULT_SIZE_MM, mmToPx } from '../../engine/units';
import type { Tool, ToolSession } from '../types';
import { normalizeShapeToolSettings } from '../shape/settings';

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

  constructor(private eng: PaintEngine) {}

  onDown(p: StrokePoint): void {
    this.cursor = { x: p.x, y: p.y };
  }

  onMove(p: StrokePoint): void {
    this.cursor = { x: p.x, y: p.y };
    this.eng.requestRender();
  }

  onUp(p: StrokePoint): void {
    const next = { x: p.x, y: p.y };
    const closeRadius = 11 * this.eng.uiScale();
    if (
      this.points.length >= 3 &&
      Math.hypot(next.x - this.points[0].x, next.y - this.points[0].y) <= closeRadius
    ) {
      this.commit();
      return;
    }
    if (
      this.points.some((point) => Math.hypot(next.x - point.x, next.y - point.y) < 0.01) ||
      openEdgeIntersects(this.points, next)
    ) {
      this.eng.notify('自己交差する頂点は追加できません');
      this.eng.requestRender();
      return;
    }
    this.points.push(next);
    this.cursor = null;
    this.syncUi();
    this.eng.requestRender();
  }

  undoPoint(): void {
    this.points.pop();
    if (!this.points.length) this.cursor = null;
    this.syncUi();
    this.eng.requestRender();
  }

  commit(): void {
    if (this.points.length < 3) return;
    if (polygonSelfIntersects(this.points)) {
      this.eng.notify('自己交差する多角形は確定できません');
      return;
    }
    const active = this.eng.activeToolSettings();
    const shapeSettings = normalizeShapeToolSettings(active?.settings);
    const shape = polygonFromWorldPoints(this.points, {
      color: active?.color ?? '#000000',
      strokeWidth: active?.sizePx ?? mmToPx(DEFAULT_SIZE_MM, this.eng.getCanvasSpec().ppi),
      paintMode: shapeSettings.paintMode,
    });
    this.points = [];
    this.cursor = null;
    this.syncUi();
    this.eng.addShapeLayer(shape);
  }

  cancel(): void {
    this.points = [];
    this.cursor = null;
    this.syncUi();
    this.eng.requestRender();
  }

  private syncUi(): void {
    this.eng.setPolygonDraftState({ active: this.points.length > 0, pointCount: this.points.length });
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.points.length) return;
    const active = this.eng.activeToolSettings();
    const shapeSettings = normalizeShapeToolSettings(active?.settings);
    const cursor = this.cursor;
    const candidate = cursor ? [...this.points, cursor] : [...this.points];
    const invalid =
      (!!cursor && openEdgeIntersects(this.points, cursor)) ||
      (candidate.length >= 3 && polygonSelfIntersects(candidate));
    ctx.save();
    ctx.strokeStyle = invalid ? '#e53935' : '#4f8cff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 1.5 * this.eng.uiScale();
    ctx.setLineDash([4 * this.eng.uiScale(), 3 * this.eng.uiScale()]);
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) ctx.lineTo(this.points[i].x, this.points[i].y);
    if (cursor) ctx.lineTo(cursor.x, cursor.y);
    if (candidate.length >= 3) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    for (const point of this.points) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4 * this.eng.uiScale(), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (candidate.length >= 3 && !invalid) {
      const preview = polygonFromWorldPoints(candidate, {
        color: active?.color === TRANSPARENT ? '#aaaaaa' : (active?.color ?? '#000'),
        strokeWidth: active?.sizePx ?? mmToPx(DEFAULT_SIZE_MM, this.eng.getCanvasSpec().ppi),
        paintMode: shapeSettings.paintMode,
      });
      ctx.globalAlpha = 0.22;
      drawShape(ctx, preview, false, this.eng.artboard);
    }
    ctx.restore();
  }
}
