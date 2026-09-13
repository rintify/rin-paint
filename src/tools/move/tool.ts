import type { StrokePoint } from '../../model';
import { unionRect, type DirtyRect } from '../../engine/brush';
import { layerHandler } from '../../engine/layer-types/registry';
import { useStore } from '../../state/store';
import type { PaintEngine } from '../../engine/PaintEngine';
import type { Tool, ToolSession } from '../types';
import { FloatSelection } from '../transform/floatSelection';

function opaqueBounds(canvas: HTMLCanvasElement): DirtyRect | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 4) {
      if (data[i + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX: maxX + 1, maxY: maxY + 1 };
}

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

  overlayAnimated(): boolean { return this.floatSelection.overlayAnimated(); }

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
      if (!this.floatSelection.beginDrag(p, true)) {
        this.floatSelection.commit();
        this.beginFromSelection();
      }
      return;
    }
    this.beginFromSelection();
    this.floatSelection.beginDrag(p, true);
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
    this.eng.ensureCanvasTransformTargets();
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
      const sparse = layer.runtime.sparse?.contentBoundsDocumentPx(this.eng.getPageSpec().ppi);
      const opaque = sparse
        ? { minX: sparse.x, minY: sparse.y, maxX: sparse.x + sparse.w, maxY: sparse.y + sparse.h }
        : opaqueBounds(layer.runtime.canvas);
      if (opaque) bounds = bounds ? unionRect(bounds, opaque) : opaque;
    }
    const ids = this.eng.effectiveTransformLayerIds();
    for (const layer of this.eng.allLayers()) {
      if (!ids.has(layer.id) || !layerHandler(layer).capabilities.objectTransform) continue;
      const box = this.eng.objectBounds(layer.id);
      if (!box) continue;
      const next = { minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h };
      bounds = bounds ? unionRect(bounds, next) : next;
    }
    return bounds;
  }
}
