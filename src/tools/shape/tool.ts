import { TRANSPARENT, type StrokePoint } from '../../model';
import { drawShape, shapeFromDrag, type DragShapeKind, drawShapeGizmo } from '../../engine/shapes';
import { constrainAxisAlignedAspect } from '../../engine/shapes/snap';
import type { PaintEngine } from '../../engine/PaintEngine';
import { DEFAULT_SIZE_MM, mmToPx } from '../../engine/units';
import type { Tool } from '../types';
import { normalizeShapeToolSettings } from './settings';

export class ShapeTool implements Tool {
  private start: StrokePoint | null = null;
  private cur: StrokePoint | null = null;
  private lastEvent: PointerEvent | undefined;

  constructor(
    private eng: PaintEngine,
    private kind: DragShapeKind,
  ) {}

  private aspectConstrained(event?: PointerEvent): boolean {
    if (this.kind !== 'rect' && this.kind !== 'ellipse') return false;
    const settings = normalizeShapeToolSettings(this.eng.activeToolSettings()?.settings);
    return (event?.shiftKey ?? false) || settings.constrainAspect;
  }

  private buildShape(end: StrokePoint, event?: PointerEvent) {
    const start = this.start;
    if (!start) return null;
    const active = this.eng.activeToolSettings();
    const color = active?.color ?? '#000';
    const size = active?.sizePx ?? mmToPx(DEFAULT_SIZE_MM, this.eng.getPageSpec().ppi);
    const settings = normalizeShapeToolSettings(active?.settings);
    const to = this.aspectConstrained(event) ? constrainAxisAlignedAspect(start, end) : end;
    const shape = shapeFromDrag(this.kind, start, to, color, size, settings.paintMode);
    return shape?.kind === 'rect'
      ? { ...shape, strokeJoin: settings.strokeJoin, cornerRadius: mmToPx(settings.cornerRadiusMm, this.eng.getPageSpec().ppi) }
      : shape;
  }

  onDown(p: StrokePoint, event?: PointerEvent): void {
    this.start = p;
    this.cur = p;
    this.lastEvent = event;
    this.eng.requestOverlayRender();
  }

  onMove(p: StrokePoint, event?: PointerEvent): void {
    if (!this.start) return;
    this.cur = p;
    this.lastEvent = event;
    this.eng.requestOverlayRender();
  }

  onUp(p: StrokePoint, event?: PointerEvent): void {
    const shape = this.buildShape(p, event);
    this.start = null;
    this.cur = null;
    this.lastEvent = undefined;
    if (shape) this.eng.addShapeLayer(shape);
    else this.eng.requestOverlayRender();
  }

  cancel(): void {
    this.start = null;
    this.cur = null;
    this.lastEvent = undefined;
    this.eng.requestOverlayRender();
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.cur) return;
    const shape = this.buildShape(this.cur, this.lastEvent);
    if (!shape) return;
    if (shape.color === TRANSPARENT) {
      drawShape(ctx, { ...shape, color: '#aaaaaa' }, false, this.eng.artboard);
    } else {
      drawShape(ctx, shape, false, this.eng.artboard);
    }
    drawShapeGizmo(ctx, shape, { scale: this.eng.uiScale() });
  }
}
