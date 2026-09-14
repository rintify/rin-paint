import type { StrokePoint } from '../../model';
import { drawShapeGizmo } from '../../engine/shapes';
import { newText } from '../../engine/text/model';
import type { PaintEngine } from '../../engine/PaintEngine';
import type { Tool } from '../types';
import { normalizeTextToolSettings } from './settings';

const HIT_THRESHOLD = 6;
const FRAME_THRESHOLD = 8;

export class TextTool implements Tool {
  private start: StrokePoint | null = null;
  private current: StrokePoint | null = null;

  constructor(private eng: PaintEngine) {}

  onDown(p: StrokePoint): void {
    this.start = p;
    this.current = p;
  }

  onMove(p: StrokePoint): void {
    this.current = p;
  }

  onUp(p: StrokePoint): void {
    const start = this.start;
    this.cancel();
    if (!start) return;
    const scale = this.eng.uiScale();
    const hit = this.eng.textAt(p.x, p.y);
    if (hit && Math.hypot(p.x - start.x, p.y - start.y) < HIT_THRESHOLD * scale) {
      this.eng.editTextLayer(hit);
      this.eng.notifyPaletteToolUsed();
      return;
    }
    const framed =
      Math.abs(p.x - start.x) > FRAME_THRESHOLD * scale &&
      Math.abs(p.y - start.y) > FRAME_THRESHOLD * scale;
    const settings = this.eng.activeToolSettings();
    this.eng.addTextLayer(
      newText(
        framed ? Math.min(p.x, start.x) : start.x,
        framed ? Math.min(p.y, start.y) : start.y,
        settings?.color ?? '#000',
        framed ? Math.abs(p.x - start.x) : null,
        framed ? Math.abs(p.y - start.y) : null,
        normalizeTextToolSettings(settings?.settings),
      ),
    );
    this.eng.notifyPaletteToolUsed();
  }

  cancel(): void {
    this.start = this.current = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.start || !this.current) return;
    const x = Math.min(this.start.x, this.current.x);
    const y = Math.min(this.start.y, this.current.y);
    const width = Math.abs(this.current.x - this.start.x);
    const height = Math.abs(this.current.y - this.start.y);
    ctx.save();
    ctx.strokeStyle = '#80bfff';
    ctx.lineWidth = this.eng.uiScale();
    ctx.strokeRect(this.start.x, this.start.y, this.current.x - this.start.x, this.current.y - this.start.y);
    ctx.restore();
    if (width > 1 && height > 1) {
      drawShapeGizmo(ctx, {
        kind: 'rect', x, y, width, height,
        color: '#000000', strokeWidth: 0, paintMode: 'stroke', rotation: 0,
      }, { scale: this.eng.uiScale() });
    }
  }
}
