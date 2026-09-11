import type { ShapeKind, StrokePoint } from '../../model';
import { drawShape, shapeFromDrag } from '../shapes';
import type { Tool, ToolContext } from './types';

export class ShapeTool implements Tool {
  private start: StrokePoint | null = null;
  private cur: StrokePoint | null = null;

  constructor(
    private ctx: ToolContext,
    private kind: ShapeKind,
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
    const settings = this.ctx.settings();
    const shape = shapeFromDrag(this.kind, start, p, settings?.color ?? '#000', settings?.size ?? 14);
    if (shape) this.ctx.addShapeLayer(shape);
  }

  cancel(): void {
    this.start = null;
    this.cur = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.cur) return;
    const settings = this.ctx.settings();
    const shape = shapeFromDrag(this.kind, this.start, this.cur, settings?.color ?? '#000', settings?.size ?? 14);
    if (!shape) return;
    if (shape.color === 'transparent') {
      drawShape(ctx, { ...shape, color: '#aaaaaa' }, false);
    } else drawShape(ctx, shape, false);
  }
}
