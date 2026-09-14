import type { StrokePoint } from '../../model';
import { unionRect, type DirtyRect } from '../../engine/brush';
import { layerHandler } from '../../engine/layer-types/registry';
import { useStore } from '../../state/store';
import type { PaintEngine } from '../../engine/PaintEngine';
import type { Tool, ToolSession } from '../types';
import { FloatSelection } from '../transform/floatSelection';
import { normalizeMoveToolSettings } from './settings';

export class MoveTool implements Tool {
  readonly latestMoveOnly = true;
  readonly floatSelection: FloatSelection;
  private refreshing = false;

  constructor(private eng: PaintEngine) {
    this.floatSelection = new FloatSelection(eng, 'レイヤーを変形');
  }

  readonly session: ToolSession = {
    active: () => this.floatSelection.phase === 'float',
    commit: () => this.floatSelection.commit(),
    cancel: () => this.floatSelection.cancelSelection(),
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

  onSettingsChange(): void {
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
    this.floatSelection.cancelSelection();
  }

  drawAboveLayer(ctx: CanvasRenderingContext2D, layerId: string): void {
    this.floatSelection.drawAboveLayer(ctx, layerId);
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    this.floatSelection.drawOverlay(ctx);
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
    const ids = this.targetLayerIds();
    const rect = this.selectionBounds(ids);
    if (!rect) {
      this.floatSelection.emitSelectionState();
      this.eng.requestOverlayRender();
      return;
    }
    const preferred = this.eng.activeRaster()?.id;
    this.floatSelection.extractFromRect(rect, preferred, ids);
  }

  private targetLayerIds(): Set<string> {
    const state = useStore.getState();
    const selected = state.multiSelectMode
      ? state.selectedLayerIds
      : [this.eng.getActiveLayerId()];
    const { includeDescendants } = normalizeMoveToolSettings(this.eng.activeToolSettings()?.settings);
    const ids = selected.flatMap((id) => includeDescendants
      ? this.eng.layerService.descendantIds(id)
      : [id]);
    return new Set(ids.filter((id) => {
      const layer = this.eng.layerById(id);
      return layer && (includeDescendants || layer.type !== 'raster' || layer.visible);
    }));
  }

  private selectionBounds(ids: ReadonlySet<string>): DirtyRect | null {
    let bounds: DirtyRect | null = null;
    for (const layer of this.eng.allLayers()) {
      if (!ids.has(layer.id)) continue;
      if (layer.type === 'raster') {
        const r = layer.runtime.surface.getContentBounds();
        if (r) {
          const next = { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h };
          bounds = bounds ? unionRect(bounds, next) : next;
        }
        continue;
      }
      if (!layerHandler(layer).capabilities.objectTransform) continue;
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
