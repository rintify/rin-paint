import type {
  PenDetailSettings,
  ShapeParams,
  StrokePoint,
  TextParams,
  TextToolSettings,
  ToolKind,
} from '../../model';
import type { DirtyRect } from '../brush';
import type { Artboard } from '../artboard';
import type { RasterLayer } from '../layers';
import type { SelectedObjectTransform } from '../PaintEngine';

export interface ActiveToolSettings {
  kind: ToolKind;
  color: string;
  size: number;
  penSettings?: PenDetailSettings;
  textSettings?: TextToolSettings;
}

export interface ToolContext {
  artboard: Artboard;
  uiScale(): number;
  settings(): ActiveToolSettings | null;
  pushColor(color: string): void;
  activeRaster(): RasterLayer | null;
  selectedRasters(): RasterLayer[];
  getActiveLayerId(): string;
  captureBefore(layer: RasterLayer): void;
  restoreBefore(layer: RasterLayer): void;
  commitRasterEdit(layer: RasterLayer, rect: DirtyRect, label: string): void;
  commitRasterBatch(
    entries: { layer: RasterLayer; before: HTMLCanvasElement; rect: DirtyRect }[],
    label: string,
    objects?: SelectedObjectTransform[],
  ): void;
  addShapeLayer(shape: ShapeParams): void;
  addTextLayer(text: TextParams): void;
  textAt(x: number, y: number): string | null;
  editTextLayer(id: string): void;
  requestRender(): void;
  bumpLayer(id: string): void;
  syncStore(): void;
  scheduleSave(): void;
  hasSelectedObjects(): boolean;
  selectedObjectsInRect(rect: DirtyRect, polygon?: { x: number; y: number }[]): SelectedObjectTransform[];
  previewObjectGroup(
    entries: SelectedObjectTransform[],
    source: { x: number; y: number }[],
    target: { x: number; y: number }[],
  ): void;
  commitObjectGroup(entries: SelectedObjectTransform[]): void;
  restoreObjectGroup(entries: SelectedObjectTransform[]): void;
  setSelectionState(state: { active: boolean; freeTransform: boolean }): void;
}

export interface ToolSession {
  /** 未確定状態(浮動選択・ドラッグ中プレビュー等)があるか */
  active(): boolean;
  commit(): void;
  cancel(): void;
}

export interface Tool {
  onDown(p: StrokePoint, e: PointerEvent): void;
  onMove(p: StrokePoint, e: PointerEvent): void;
  onUp(p: StrokePoint, e: PointerEvent): void;
  cancel?(): void;
  drawOverlay?(ctx: CanvasRenderingContext2D): void;
  /** 全 raster レイヤー合成時に呼ばれる。関係ある layerId のみ描く */
  drawAboveLayer?(ctx: CanvasRenderingContext2D, layerId: string): void;
  readonly session?: ToolSession;
}
