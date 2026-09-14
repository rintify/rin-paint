import type { RasterSurface } from '../engine/raster/RasterSurface';
import type { AdjustParams } from './adjust';
import type { BlendMode } from './blend';
import type { ImageParams } from './image';
import type { LayerParameterLink } from './layer';
import type { OutlineParams } from './outline';
import type { ShapeParams } from './shape';
import type { TransformState } from './transform';
import type { TextParams } from './text';

export interface LayerCommon {
  id: string;
  name: string;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  parentId: string | null;
  childIds: string[];
  parameterLink?: LayerParameterLink;
}

export interface LayerCommonRecord {
  name: string;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  parentId: string | null;
  childIds: string[];
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

export interface CanvasRuntime {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export interface KindSpec<S, R> {
  state: S;
  runtime: R;
}

export interface LayerKindMap {
  transform: KindSpec<TransformState, undefined>;
  raster: KindSpec<RasterState, { surface: RasterSurface }>;
  adjust: KindSpec<AdjustState, undefined>;
  outline: KindSpec<OutlineState, undefined>;
  clip: KindSpec<ClipState, undefined>;
  shape: KindSpec<ShapeState, undefined>;
  text: KindSpec<TextState, undefined>;
  image: KindSpec<ImageState, CanvasRuntime>;
}

export type LayerType = keyof LayerKindMap;
export type LayerState = LayerKindMap[LayerType]['state'];
export type LayerRuntime = LayerKindMap[LayerType]['runtime'];

export const LAYER_TYPES: readonly LayerType[] = [
  'transform',
  'raster',
  'adjust',
  'outline',
  'clip',
  'shape',
  'text',
  'image',
];

export function isLayerType(value: string): value is LayerType {
  return (LAYER_TYPES as readonly string[]).includes(value);
}
