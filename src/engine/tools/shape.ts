import { useStore } from '../../state/store';
import { TRANSPARENT, type StrokePoint } from '../../types';
import { checkerPattern, emptyRect, expandRect, type DirtyRect } from '../brush';
import type { PaintEngine } from '../PaintEngine';
import type { Tool } from './types';

export type ShapeKind = 'line' | 'rect' | 'ellipse';

const LABELS: Record<ShapeKind, string> = {
  line: '直線',
  rect: '四角形',
  ellipse: '楕円',
};

export class ShapeTool implements Tool {
  private start: StrokePoint | null = null;
  private cur: StrokePoint | null = null;

  constructor(
    private engine: PaintEngine,
    private kind: ShapeKind,
  ) {}

  onDown(p: StrokePoint): void {
    if (!this.engine.activeRaster()) return;
    this.start = p;
    this.cur = p;
  }

  onMove(p: StrokePoint): void {
    if (this.start) this.cur = p;
  }

  onUp(p: StrokePoint): void {
    const layer = this.engine.activeRaster();
    const start = this.start;
    this.start = null;
    if (!start || !layer) return;
    this.cur = p;
    const size = useStore.getState().penSize;
    this.engine.captureBefore(layer);
    this.paint(layer.ctx, start, p, true);
    const rect: DirtyRect = emptyRect();
    expandRect(rect, start.x, start.y, size + 2);
    expandRect(rect, p.x, p.y, size + 2);
    this.engine.commitRasterEdit(layer, rect, LABELS[this.kind]);
    useStore.getState().pushColor(useStore.getState().penColor);
  }

  cancel(): void {
    this.start = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (this.start && this.cur) this.paint(ctx, this.start, this.cur, false);
  }

  private paint(
    ctx: CanvasRenderingContext2D,
    a: StrokePoint,
    b: StrokePoint,
    onLayer: boolean,
  ): void {
    const st = useStore.getState();
    ctx.save();
    if (st.penColor === TRANSPARENT) {
      if (onLayer) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = '#000000';
      } else {
        // プレビューでは市松模様で「透明で描く」ことを示す
        ctx.strokeStyle = checkerPattern(ctx);
      }
    } else {
      ctx.strokeStyle = st.penColor;
    }
    ctx.lineWidth = st.penSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (this.kind === 'line') {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    } else if (this.kind === 'rect') {
      ctx.rect(
        Math.min(a.x, b.x),
        Math.min(a.y, b.y),
        Math.abs(b.x - a.x),
        Math.abs(b.y - a.y),
      );
    } else {
      ctx.ellipse(
        (a.x + b.x) / 2,
        (a.y + b.y) / 2,
        Math.abs(b.x - a.x) / 2,
        Math.abs(b.y - a.y) / 2,
        0,
        0,
        Math.PI * 2,
      );
    }
    ctx.stroke();
    ctx.restore();
  }
}
