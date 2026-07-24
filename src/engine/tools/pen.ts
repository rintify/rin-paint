import { useStore } from '../../state/store';
import { TRANSPARENT, type StrokePoint } from '../../types';
import { emptyRect, expandRect, stampSegment, type DirtyRect } from '../brush';
import type { RasterLayer } from '../layers';
import type { PaintEngine } from '../PaintEngine';
import type { Tool } from './types';

export class PenTool implements Tool {
  private layer: RasterLayer | null = null;
  private lastX = 0;
  private lastY = 0;
  private lastR = 0;
  private press = 0.5;
  private size = 10;
  private color = '#000';
  /** 透明色ストローク (destination-out で消す) */
  private erase = false;
  private rect: DirtyRect = emptyRect();
  private t0 = 0;
  private moved = 0;

  constructor(private engine: PaintEngine) {}

  private radius(pressure: number): number {
    this.press = this.press * 0.5 + pressure * 0.5;
    return Math.max(0.35, this.size * 0.5 * (0.12 + 0.88 * this.press));
  }

  onDown(p: StrokePoint): void {
    const layer = this.engine.activeRaster();
    if (!layer) return;
    this.layer = layer;
    this.engine.captureBefore(layer);
    const st = useStore.getState();
    this.size = st.penSize;
    this.color = st.penColor;
    this.erase = st.penColor === TRANSPARENT;
    this.press = p.pressure;
    this.rect = emptyRect();
    this.t0 = performance.now();
    this.moved = 0;
    const r = this.radius(p.pressure);
    stampSegment(layer.ctx, p.x, p.y, r, p.x, p.y, r, this.color, this.erase);
    expandRect(this.rect, p.x, p.y, r + 2);
    this.lastX = p.x;
    this.lastY = p.y;
    this.lastR = r;
    this.engine.requestRender();
  }

  onMove(p: StrokePoint): void {
    if (!this.layer) return;
    const r = this.radius(p.pressure);
    stampSegment(
      this.layer.ctx,
      this.lastX,
      this.lastY,
      this.lastR,
      p.x,
      p.y,
      r,
      this.color,
      this.erase,
    );
    this.moved += Math.hypot(p.x - this.lastX, p.y - this.lastY);
    expandRect(this.rect, this.lastX, this.lastY, this.lastR + 2);
    expandRect(this.rect, p.x, p.y, r + 2);
    this.lastX = p.x;
    this.lastY = p.y;
    this.lastR = r;
    this.engine.requestRender();
  }

  onUp(): void {
    if (!this.layer) return;
    const quick = performance.now() - this.t0 < 250 && this.moved < 8;
    this.engine.commitRasterEdit(
      this.layer,
      this.rect,
      this.erase ? '透明ペン' : 'ペン',
      { tapCandidate: quick },
    );
    useStore.getState().pushColor(this.color);
    this.layer = null;
  }

  cancel(): void {
    if (!this.layer) return;
    this.engine.restoreBefore(this.layer);
    this.layer = null;
    this.engine.requestRender();
  }
}
