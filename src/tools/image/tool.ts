import type { StrokePoint } from '../../model';
import { drawShapeGizmo } from '../../engine/shapes';
import type { PaintEngine } from '../../engine/PaintEngine';
import { canvasFromImageFile } from '../../engine/image/load';
import { pickFile } from '../../components/hooks/pickFile';
import type { Tool } from '../types';
import { imageToolBoxPx } from './settings';

export class ImageTool implements Tool {
  private start: StrokePoint | null = null;
  private placing = false;

  constructor(private eng: PaintEngine) {}

  onDown(p: StrokePoint): void {
    this.start = p;
    this.eng.requestOverlayRender();
  }

  onMove(): void {
    this.eng.requestOverlayRender();
  }

  onUp(): void {
    const start = this.start;
    this.start = null;
    this.eng.requestOverlayRender();
    if (!start || this.placing || this.eng.isBusy()) return;
    this.placing = true;
    void this.placeAt(start).finally(() => { this.placing = false; });
  }

  cancel(): void {
    this.start = null;
    this.eng.requestOverlayRender();
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const start = this.start;
    if (!start) return;
    const { width, height } = this.boxPx();
    ctx.save();
    ctx.strokeStyle = '#80bfff';
    ctx.setLineDash([6 * this.eng.uiScale(), 4 * this.eng.uiScale()]);
    ctx.lineWidth = this.eng.uiScale();
    ctx.strokeRect(start.x, start.y, width, height);
    ctx.restore();
    drawShapeGizmo(ctx, {
      kind: 'rect',
      x: start.x,
      y: start.y,
      width,
      height,
      color: '#000000',
      strokeWidth: 0,
      paintMode: 'stroke',
      rotation: 0,
    }, { scale: this.eng.uiScale() });
  }

  private boxPx(): { width: number; height: number } {
    return imageToolBoxPx(this.eng.activeToolSettings()?.settings, this.eng.getPageSpec().ppi);
  }

  private async placeAt(point: StrokePoint): Promise<void> {
    const file = await pickFile('image/*');
    if (!file) return;
    const canvas = await canvasFromImageFile(file);
    if (!canvas) {
      this.eng.notify('画像ファイルを選択してください');
      return;
    }
    const { width, height } = this.boxPx();
    this.eng.addImageLayer(canvas, point.x, point.y, width, height);
    this.eng.notifyPaletteToolUsed();
  }
}
