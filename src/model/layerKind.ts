import type { AdjustParams } from './adjust';
import type { BlendMode } from './blend';
import type { ImageParams } from './image';
import type { LayerParameterLink } from './layer';
import type { OutlineParams } from './outline';
import type { ShapeParams } from './shape';
import type { TextParams } from './text';
import type { Homography } from './geometry';

export interface LayerCommon {
  id: string;
  name: string;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  parameterLink?: LayerParameterLink;
  linkRecovery?: {link: LayerParameterLink; signature: string};
}

export interface LayerCommonRecord {
  name: string;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  parameterLink?: LayerParameterLink;
  linkRecovery?: {link: LayerParameterLink; signature: string};
}

export interface RasterState { matrix: Homography }

export interface CanvasState { propagateTransforms: boolean }
export interface TransformState { matrix: Homography }

export interface AdjustState {
  params: AdjustParams;
  maskLayerIds: string[];
}

export interface OutlineState {
  matrix?: Homography;
  outline: OutlineParams;
}

export interface ClipState {
  maskLayerIds: string[];
}

export interface ShapeState {
  matrix?: Homography;
  shape: ShapeParams;
  snapEnabled: boolean;
}

export interface TextState {
  matrix?: Homography;
  text: TextParams;
  snapEnabled: boolean;
}

export interface ImageState {
  matrix?: Homography;
  placement: ImageParams;
  snapEnabled: boolean;
  constrainAspect: boolean;
}

export interface ImageRuntime {asset: import('../engine/image/ImageAsset').ImageAsset}

export interface KindSpec<S, R> {
  state: S;
  runtime: R;
}

export interface LayerKindMap {
  canvas: KindSpec<CanvasState, undefined>;
  transform: KindSpec<TransformState, undefined>;
  raster: KindSpec<RasterState, {surface: import('../engine/raster/RasterSurface').RasterSurface}>;
  adjust: KindSpec<AdjustState, undefined>;
  outline: KindSpec<OutlineState, undefined>;
  clip: KindSpec<ClipState, undefined>;
  shape: KindSpec<ShapeState, undefined>;
  text: KindSpec<TextState, undefined>;
  image: KindSpec<ImageState, ImageRuntime>;
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
