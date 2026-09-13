import type { StrokePoint } from '../../model';
import { drawShape, polygonFromWorldPoints } from '../../engine/shapes';
import { constrainAxisAlignedAspect } from '../../engine/shapes/snap';
import type { PaintEngine } from '../../engine/PaintEngine';
import type { Tool } from '../types';
import { normalizePanelFrameToolSettings } from './settings';

export class PanelFrameTool implements Tool {
  readonly startsImmediately = true;
  readonly allowsDirectShapeEdit = false;
  private start: StrokePoint | null = null;
  private current: StrokePoint | null = null;
  private event: PointerEvent | undefined;

  constructor(private engine: PaintEngine) {}

  private shape(end: StrokePoint, event?: PointerEvent) {
    if (!this.start) return null;
    const active = this.engine.activeToolSettings();
    const settings = normalizePanelFrameToolSettings(active?.settings);
    const point = (event?.shiftKey || settings.constrainAspect)
      ? constrainAxisAlignedAspect(this.start, end) : end;
    const left = Math.min(this.start.x, point.x);
    const top = Math.min(this.start.y, point.y);
    const right = Math.max(this.start.x, point.x);
    const bottom = Math.max(this.start.y, point.y);
    if (right - left < 1 || bottom - top < 1) return null;
    return polygonFromWorldPoints([
      { x: left, y: top }, { x: right, y: top },
      { x: right, y: bottom }, { x: left, y: bottom },
    ], {
      color: active?.color ?? '#ffffff',
      strokeWidth: 0,
      paintMode: 'fill-inside',
      strokeJoin: 'miter',
      cornerRadius: 0,
    });
  }

  onDown(point: StrokePoint, event: PointerEvent): void {
    this.start = point;
    this.current = point;
    this.event = event;
  }

  onMove(point: StrokePoint, event: PointerEvent): void {
    if (!this.start) return;
    this.current = point;
    this.event = event;
    this.engine.requestOverlayRender();
  }

  onUp(point: StrokePoint, event: PointerEvent): void {
    const shape = this.shape(point, event);
    this.start = null;
    this.current = null;
    this.event = undefined;
    if (!shape) return this.engine.requestOverlayRender();
    const active = this.engine.activeToolSettings();
    const settings = normalizePanelFrameToolSettings(active?.settings);
    this.engine.addPanelFrame(shape, {
      outlineColor: settings.outlineColor,
      outlineWidthMm: active?.sizeMm ?? 1,
    });
  }

  cancel(): void {
    this.start = null;
    this.current = null;
    this.event = undefined;
    this.engine.requestOverlayRender();
  }

  drawOverlay(context: CanvasRenderingContext2D): void {
    if (!this.current) return;
    const shape = this.shape(this.current, this.event);
    if (shape) drawShape(context, shape, false, this.engine.artboard);
  }
}
