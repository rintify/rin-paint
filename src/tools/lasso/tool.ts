import type { StrokePoint } from '../../model';
import type { RasterLayer } from '../../engine/layers';
import type { PaintEngine } from '../../engine/PaintEngine';
import type { Tool, ToolSession } from '../types';
import { FloatSelection, type Pt } from '../transform/floatSelection';

export class LassoTool implements Tool {
  private drawing = false;
  private pts: Pt[] = [];
  private layer: RasterLayer | null = null;
  readonly floatSelection: FloatSelection;

  constructor(private eng: PaintEngine) {
    this.floatSelection = new FloatSelection(eng, '複数レイヤーの選択範囲');
  }

  get phase(): 'idle' | 'draw' | 'float' {
    if (this.drawing) return 'draw';
    return this.floatSelection.phase;
  }

  get free(): boolean {
    return this.floatSelection.free;
  }

  readonly session: ToolSession = {
    active: () => this.phase !== 'idle',
    commit: () => this.commit(),
    cancel: () => this.cancelSelection(),
  };

  overlayAnimated(): boolean { return this.floatSelection.overlayAnimated(); }

  setFreeTransform(on: boolean): void {
    this.floatSelection.setFreeTransform(on);
  }

  onDown(p: StrokePoint): void {
    if (this.floatSelection.phase === 'float') {
      if (!this.floatSelection.beginDrag(p)) {
        this.floatSelection.commit();
        this.beginDraw(p);
      }
      return;
    }
    this.beginDraw(p);
  }

  private beginDraw(p: StrokePoint): void {
    const layers = this.eng.selectedRasters();
    const layer = layers.find(item => item.id === this.eng.activeRaster()?.id) ?? layers[0];
    if (!layer && !this.eng.hasSelectedObjects()) {
      this.drawing = false;
      return;
    }
    this.layer = layer ?? null;
    this.drawing = true;
    this.pts = [{ x: p.x, y: p.y }];
  }

  onMove(p: StrokePoint): void {
    if (this.drawing) {
      const last = this.pts[this.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 2) {
        this.pts.push({ x: p.x, y: p.y });
        this.eng.requestOverlayRender();
      }
      return;
    }
    this.floatSelection.dragTo(p);
  }

  onUp(): void {
    if (this.drawing) {
      this.drawing = false;
      if (this.pts.length >= 3) {
        if (!this.floatSelection.extractFromPolygon(this.pts, this.layer?.id)) this.layer = null;
      } else {
        this.layer = null;
        this.floatSelection.emitSelectionState();
      }
      this.pts = [];
      this.eng.syncStore();
      return;
    }
    this.floatSelection.endDrag();
  }

  cancel(): void {
    if (this.drawing) {
      this.drawing = false;
      this.pts = [];
      this.layer = null;
    }
    this.floatSelection.endDrag();
    this.eng.requestOverlayRender();
  }

  duplicate(): void {
    this.floatSelection.duplicate();
  }

  commit(): void {
    this.drawing = false;
    this.pts = [];
    this.layer = null;
    this.floatSelection.commit();
  }

  cancelSelection(): void {
    this.drawing = false;
    this.pts = [];
    this.layer = null;
    this.floatSelection.cancelSelection();
  }

  drawAboveLayer(ctx: CanvasRenderingContext2D, layerId: string): void {
    this.floatSelection.drawAboveLayer(ctx, layerId);
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const s = this.eng.uiScale();
    if (this.drawing && this.pts.length > 1) {
      ctx.save();
      ctx.lineWidth = 1.5 * s;
      ctx.setLineDash([6 * s, 4 * s]);
      ctx.strokeStyle = '#4f8cff';
      ctx.beginPath();
      ctx.moveTo(this.pts[0].x, this.pts[0].y);
      for (let i = 1; i < this.pts.length; i++) ctx.lineTo(this.pts[i].x, this.pts[i].y);
      ctx.stroke();
      ctx.restore();
      return;
    }
    this.floatSelection.drawOverlay(ctx);
  }
}
