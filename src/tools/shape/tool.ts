import { TRANSPARENT, type StrokePoint } from '../../model';
import { drawShape, shapeFromDrag, type DragShapeKind } from '../../engine/shapes';
import type { PaintEngine } from '../../engine/PaintEngine';
import type { Tool } from '../types';
import { normalizeShapeToolSettings } from './settings';

export class ShapeTool implements Tool {
  private start: StrokePoint | null = null;
  private cur: StrokePoint | null = null;

  constructor(
    private eng: PaintEngine,
    private kind: DragShapeKind,
  ) {}

  onDown(p: StrokePoint): void {
    this.start = p;
    this.cur = p;
  }

  onMove(p: StrokePoint): void {
    if (this.start) this.cur = p;
  }

  onUp(p: StrokePoint): void {
    const start = this.start;
    this.start = null;
    this.cur = null;
    if (!start) return;
    const active = this.eng.activeToolSettings();
    const color = active?.color ?? '#000';
    const size = active?.size ?? 14;
    const paintMode = normalizeShapeToolSettings(active?.settings).paintMode;
    const shape = shapeFromDrag(this.kind, start, p, color, size, paintMode);
    if (shape) this.eng.addShapeLayer(shape);
  }

  cancel(): void {
    this.start = null;
    this.cur = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.cur) return;
    const active = this.eng.activeToolSettings();
    const color = active?.color ?? '#000';
    const size = active?.size ?? 14;
    const paintMode = normalizeShapeToolSettings(active?.settings).paintMode;
    const shape = shapeFromDrag(this.kind, this.start, this.cur, color, size, paintMode);
    if (!shape) return;
    if (shape.color === TRANSPARENT) {
      drawShape(ctx, { ...shape, color: '#aaaaaa' }, false, this.eng.artboard);
    } else {
      drawShape(ctx, shape, false, this.eng.artboard);
    }
  }
}
