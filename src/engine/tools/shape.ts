import { useStore } from '../../state/store';
import type { ShapeKind, StrokePoint } from '../../types';
import { drawShape, shapeFromDrag } from '../shapes';
import type { PaintEngine } from '../PaintEngine';
import type { Tool } from './types';

export class ShapeTool implements Tool {
  private start: StrokePoint | null = null;
  private cur: StrokePoint | null = null;

  constructor(
    private engine: PaintEngine,
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
    const state = useStore.getState();
    const shape = shapeFromDrag(this.kind, start, p, state.penColor, state.penSize);
    if (shape) this.engine.addShapeLayer(shape);
  }

  cancel(): void {
    this.start = null;
    this.cur = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.cur) return;
    const state = useStore.getState();
    const shape = shapeFromDrag(this.kind, this.start, this.cur, state.penColor, state.penSize);
    if (!shape) return;
    if (shape.color === 'transparent') {
      drawShape(ctx, { ...shape, color: '#aaaaaa' }, false);
    } else drawShape(ctx, shape, false);
  }
}
