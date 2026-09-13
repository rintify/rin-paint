import type { AdjustParams } from './adjust';
import type { BlendMode } from './blend';
import type { ImageParams } from './image';
import type { LayerParameterLink } from './layer';
import type { OutlineParams } from './outline';
import type { ShapeParams } from './shape';
import type { TextParams } from './text';
import type { HierarchyItem } from './hierarchy';
import type { TransformState } from './transform';
import type { ScopedLayerAddress } from './document';

export interface LayerCommon {
  id: string;
  name: string;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  parameterLink?: LayerParameterLink;
}

/** Hierarchy placement is kept apart from linkable layer data. */
export interface LayerPlacement {
  scopeId: string | null;
  scopeLayerIds: string[];
  /** Whole-data link owned by this occurrence. Placement changes never detach it. */
  dataLink?: ScopedLayerAddress;
  /** Distinguishes multiple placements of the same bin asset in one document. */
  dataLinkInstanceId?: string;
  /** Stable child key retained after COW so linked Canvas structure still follows. */
  canvasStructureSource?: ScopedLayerAddress;
}

export interface LayerCommonRecord {
  name: string;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  parameterLink?: LayerParameterLink;
}

export type RasterState = Record<string, never>;

export interface AdjustState {
  params: AdjustParams;
  maskLayerIds: string[];
}

export interface OutlineState {
  outline: OutlineParams;
}

export interface ClipState {
  maskLayerIds: string[];
}

export interface ShapeState {
  shape: ShapeParams;
  snapEnabled: boolean;
}

export interface TextState {
  text: TextParams;
  snapEnabled: boolean;
}

export interface ImageState {
  placement: ImageParams;
  snapEnabled: boolean;
  constrainAspect: boolean;
}

export interface CanvasLayerState {
  hierarchy: HierarchyItem[];
  propagateTransform: boolean;
}

export interface CanvasRuntime {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Empty raster layers can postpone their pageFrame-sized allocation. */
  deferred?: boolean;
  logicalWidth?: number;
  logicalHeight?: number;
  /** null means known empty; undefined means unknown/full for legacy content. */
  contentBounds?: { x: number; y: number; w: number; h: number } | null;
  /** Unbounded canonical storage for raster layers. The page-sized canvas is a working window. */
  sparse?: import('../engine/raster/SparseRasterSurface').SparseRasterSurface;
}

export interface KindSpec<S, R> {
  state: S;
  runtime: R;
}

export interface LayerKindMap {
  raster: KindSpec<RasterState, CanvasRuntime>;
  adjust: KindSpec<AdjustState, undefined>;
  outline: KindSpec<OutlineState, undefined>;
  clip: KindSpec<ClipState, undefined>;
  shape: KindSpec<ShapeState, undefined>;
  text: KindSpec<TextState, undefined>;
  image: KindSpec<ImageState, CanvasRuntime>;
  canvas: KindSpec<CanvasLayerState, undefined>;
  transform: KindSpec<TransformState, undefined>;
}

export type LayerType = keyof LayerKindMap;
export type LayerState = LayerKindMap[LayerType]['state'];
export type LayerRuntime = LayerKindMap[LayerType]['runtime'];

export const LAYER_TYPES: readonly LayerType[] = [
  'raster', 'adjust', 'outline', 'clip', 'shape', 'text', 'image', 'canvas', 'transform',
];

export function isLayerType(value: string): value is LayerType {
  return (LAYER_TYPES as readonly string[]).includes(value);
}
