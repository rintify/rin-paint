import type { StrokePoint } from '../../model';
import { unionRect, type DirtyRect } from '../../engine/brush';
import { layerHandler } from '../../engine/layer-types/registry';
import { useStore } from '../../state/store';
import type { PaintEngine } from '../../engine/PaintEngine';
import type { Tool, ToolSession } from '../types';
import { FloatSelection } from '../transform/floatSelection';

export class MoveTool implements Tool {
  readonly floatSelection: FloatSelection;
  private refreshing = false;

  constructor(private eng: PaintEngine) {
    this.floatSelection = new FloatSelection(eng, 'レイヤーを変形');
  }

  readonly session: ToolSession = {
    active: () => this.floatSelection.phase === 'float',
    commit: () => this.floatSelection.commit(),
    cancel: () => this.cancelAndRefresh(),
  };

  overlayAnimated(): boolean {
    return this.floatSelection.overlayAnimated();
  }

  setFreeTransform(on: boolean): void {
    this.floatSelection.setFreeTransform(on);
  }

  onActivate(): void {
    this.refresh();
  }

  onLayerSelectionChange(): void {
    this.refresh();
  }

  onDown(p: StrokePoint): void {
    if (this.floatSelection.phase === 'float') {
      if (!this.floatSelection.beginDrag(p)) {
        this.floatSelection.commit();
        this.beginFromSelection();
      }
      return;
    }
    this.beginFromSelection();
    this.floatSelection.beginDrag(p);
  }

  onMove(p: StrokePoint): void {
    this.floatSelection.dragTo(p);
  }

  onUp(): void {
    this.floatSelection.endDrag();
  }

  cancel(): void {
    this.floatSelection.endDrag();
    this.eng.requestOverlayRender();
  }

  duplicate(): void {
    this.floatSelection.duplicate();
  }

  commit(): void {
    this.floatSelection.commit();
  }

  cancelSelection(): void {
    this.cancelAndRefresh();
  }

  drawAboveLayer(ctx: CanvasRenderingContext2D, layerId: string): void {
    this.floatSelection.drawAboveLayer(ctx, layerId);
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    this.floatSelection.drawOverlay(ctx);
  }

  private cancelAndRefresh(): void {
    this.floatSelection.cancelSelection();
    if (useStore.getState().tool === 'move') this.beginFromSelection();
  }

  private refresh(): void {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      if (this.floatSelection.phase === 'float') this.floatSelection.commit();
      this.beginFromSelection();
    } finally {
      this.refreshing = false;
    }
  }

  private beginFromSelection(): void {
    const rect = this.selectionBounds();
    if (!rect) {
      this.floatSelection.emitSelectionState();
      this.eng.requestOverlayRender();
      return;
    }
    const preferred = this.eng.activeRaster()?.id;
    this.floatSelection.extractFromRect(rect, preferred);
  }

  private selectionBounds(): DirtyRect | null {
    let bounds: DirtyRect | null = null;
    for (const layer of this.eng.selectedRasters()) {
      const r = layer.runtime.surface.getContentBounds();
      const opaque = r
        ? { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h }
        : null;
      if (opaque) bounds = bounds ? unionRect(bounds, opaque) : opaque;
    }
    const ids = new Set(useStore.getState().selectedLayerIds);
    for (const layer of this.eng.allLayers()) {
      if (
        !ids.has(layer.id) ||
        !layerHandler(layer).capabilities.objectTransform
      )
        continue;
      const box = this.eng.objectBounds(layer.id);
      if (!box) continue;
      const next = {
        minX: box.x,
        minY: box.y,
        maxX: box.x + box.w,
        maxY: box.y + box.h,
      };
      bounds = bounds ? unionRect(bounds, next) : next;
    }
    return bounds;
  }
}
