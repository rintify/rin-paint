import type { StoredRasterContent } from '../raster/RasterAssetRepository';
import type { LayerCommonRecord, LayerType } from '../../model';
import type { Layer, LayerOf } from '../layers';
import type { ParameterCatalog } from '../parameters/types';
import type { LoadResult } from '../schema';
import type {
  ArtboardSize,
  CanvasLease,
  EffectCacheStore,
  EffectScope,
  LayerDrawEnv,
  LayerMeasureEnv,
  MaskCanvas,
  ObjectBounds,
  Point,
  RenderStatsAccumulator,
} from './types';

export type {
  ArtboardSize,
  CanvasLease,
  EffectCacheStore,
  EffectScope,
  LayerDrawEnv,
  LayerMeasureEnv,
  MaskCanvas,
  ObjectBounds,
  Point,
  RenderStatsAccumulator,
};

export interface LayerTypeInfo {
  type: LayerType;
  kindId: string;
  revision: number;
  canMask: boolean;
  maskSourceLabel: string | null;
  supportsBlend: boolean;
  defaultName(index: number): string;
  addMenu?: { group: 'raster' | 'effect'; label: string; historyLabel: string };
  effectBadge?: string;
}

export interface LayerStateAdapter<K extends LayerType> {
  initial(): LayerOf<K>['state'];
  clone(state: LayerOf<K>['state']): LayerOf<K>['state'];
  normalize(state: LayerOf<K>['state']): LayerOf<K>['state'];
  applyPatch(
    state: LayerOf<K>['state'],
    patch: Partial<LayerOf<K>['state']>,
  ): LayerOf<K>['state'];
  scale(
    state: LayerOf<K>['state'],
    factor: number,
    env: { width: number; height: number },
  ): LayerOf<K>['state'];
  remapReferences?(
    state: LayerOf<K>['state'],
    mapId: (id: string) => string | undefined,
  ): LayerOf<K>['state'];
}

export interface LayerCodec<K extends LayerType> {
  encode(state: LayerOf<K>['state']): unknown;
  decode(value: unknown): LayerOf<K>['state'] | null;
  encodeContent?(
    layer: LayerOf<K>,
  ): Promise<Blob | StoredRasterContent | undefined>;
  decodeRuntime?(
    content: Blob | StoredRasterContent | HTMLCanvasElement | undefined,
    env: { artboard: ArtboardSize },
  ): Promise<LayerOf<K>['runtime'] | null>;
  scaleStored?(
    state: unknown,
    env: { artboard: ArtboardSize; factor: number },
  ): unknown;
}

export interface LayerRenderer<K extends LayerType> {
  draw(
    ctx: CanvasRenderingContext2D,
    layer: LayerOf<K>,
    env: LayerDrawEnv,
  ): void;
  drawThumbnail?(
    ctx: CanvasRenderingContext2D,
    layer: LayerOf<K>,
    env: { width: number; height: number; artboard: ArtboardSize },
  ): void;
  drawMask?(
    ctx: CanvasRenderingContext2D,
    layer: LayerOf<K>,
    env: LayerDrawEnv,
  ): void;
  contentCanvas(
    layer: LayerOf<K>,
    env: LayerMeasureEnv,
  ): HTMLCanvasElement | null;
  effect?: {
    apply(scope: EffectScope, layer: LayerOf<K>, env: LayerDrawEnv): void;
    /** Nonlocal effects request their upstream pixels in source coordinates. */
    sourceRegion?(
      region: import('../raster/geometry').PixelRect,
      layer: LayerOf<K>,
      env: LayerDrawEnv,
      available: import('../raster/geometry').PixelRect | null,
    ): import('../raster/geometry').PixelRect | null;
    mapBounds?(
      bounds: import('../raster/geometry').PixelRect,
      layer: LayerOf<K>,
      env: LayerDrawEnv,
    ): import('../raster/geometry').PixelRect | null;
    /** Maps source damage to output coordinates, including the sampling footprint.
     * null means unbounded; the compositor falls back to the whole output. */
    mapDamage?(
      bounds: import('../raster/geometry').PixelRect,
      layer: LayerOf<K>,
      env: LayerDrawEnv,
    ): import('../raster/geometry').PixelRect | null;
    paddingPx?(layer: LayerOf<K>, env: LayerDrawEnv): number;
    dependencyLayerIds?(layer: LayerOf<K>): readonly string[];
    /** 効果自身が足した可視画素をクリック選択の対象にする。 */
    clickableAddedPixels?: boolean;
  };
  eraser?: {
    applies(layer: LayerOf<K>): boolean;
    draw(
      ctx: CanvasRenderingContext2D,
      layer: LayerOf<K>,
      env: LayerDrawEnv,
    ): void;
  };
}

export interface ObjectTransformCapability<K extends LayerType> {
  bounds(layer: LayerOf<K>, env: LayerMeasureEnv): ObjectBounds | null;
  apply(
    layer: LayerOf<K>,
    context: {
      before: LayerOf<K>['state'];
      transform(x: number, y: number): Point;
      scale: number;
      angle: number;
      width?: number;
      height?: number;
    },
  ): void;
}

export interface FrameEditCapability<K extends LayerType> {
  toShape(layer: LayerOf<K>): import('../../model').ShapeParams;
  fromShape(layer: LayerOf<K>, shape: import('../../model').ShapeParams): void;
  constrainAspect?(layer: LayerOf<K>): boolean;
}

export interface VertexEditCapability<K extends LayerType> {
  enabled(layer: LayerOf<K>): boolean;
}

export interface MaskSourceCapability<K extends LayerType> {
  nativeCanvas?(layer: LayerOf<K>): HTMLCanvasElement | null;
  drawOpacity(layer: LayerOf<K>): number;
  uncacheable?(layer: LayerOf<K>): boolean;
}

export interface TransferCapability<K extends LayerType> {
  canTransfer(layer: LayerOf<K>): boolean;
}

export interface RenderLifecycleCapability<K extends LayerType> {
  prepare?(layer: LayerOf<K>, env: LayerMeasureEnv, onReady?: () => void): void;
}

export interface LayerCapabilities<K extends LayerType> {
  objectTransform?: ObjectTransformCapability<K>;
  frameEdit?: FrameEditCapability<K>;
  vertexEdit?: VertexEditCapability<K>;
  maskSource?: MaskSourceCapability<K>;
  transferToRaster?: TransferCapability<K>;
  renderLifecycle?: RenderLifecycleCapability<K>;
}

export interface LayerSchema<K extends LayerType> {
  loadDefaults: LayerOf<K>['state'];
  createDefaults: LayerOf<K>['state'];
  /** Convert older owned state to this module revision before validation. */
  migrate?(raw: unknown, fromRevision: number): LoadResult<unknown>;
  load(raw: unknown): LoadResult<LayerOf<K>['state']>;
}

export interface LayerFactory<K extends LayerType> {
  create(name: string, id?: string): LayerOf<K>;
}

export interface LayerDefinition<K extends LayerType> {
  info: LayerTypeInfo;
  factory: LayerFactory<K>;
  schema: LayerSchema<K>;
  state: LayerStateAdapter<K>;
  codec: LayerCodec<K>;
  renderer: LayerRenderer<K>;
  parameters:
    | ParameterCatalog<LayerOf<K>['state']>
    | ((
        layer: LayerOf<K> | { type: K; state: LayerOf<K>['state'] },
      ) => ParameterCatalog<LayerOf<K>['state']>);
  capabilities: LayerCapabilities<K>;
  enumerateLayerIds?(state: LayerOf<K>['state']): string[];
  enumerateAssetIds?(layer: LayerOf<K>): string[];
}

export interface LayerRecord {
  id: string;
  type: string;
  kindId?: string;
  revision?: number;
  common: LayerCommonRecord;
  state: unknown;
  content?: Blob | StoredRasterContent;
}

export interface LayerSnapshot extends LayerRecord {
  canvas?: HTMLCanvasElement;
}

export interface LayerProps {
  name?: string;
  opacity?: number;
  blend?: import('../../model').BlendMode;
  visible?: boolean;
  parameterLink?: import('../../model').LayerParameterLink | null;
  state?: unknown;
}

export function layerMaskIds(state: unknown): string[] {
  if (!state || typeof state !== 'object') return [];
  const ids = (state as { maskLayerIds?: unknown }).maskLayerIds;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === 'string')
    : [];
}

export function commonRecordFrom(layer: Layer): LayerCommonRecord {
  return {
    name: layer.name,
    opacity: layer.opacity,
    blend: layer.blend,
    visible: layer.visible,
    parentId: layer.parentId,
    childIds: [...layer.childIds],
    ...(layer.parameterLink
      ? { parameterLink: structuredClone(layer.parameterLink) }
      : {}),
  };
}

export function applyCommonRecord(
  layer: Layer,
  common: LayerCommonRecord,
): void {
  layer.name = common.name;
  layer.opacity = common.opacity;
  layer.blend = common.blend;
  layer.visible = common.visible;
  layer.parentId = common.parentId;
  layer.childIds = [...common.childIds];
  layer.parameterLink = common.parameterLink
    ? structuredClone(common.parameterLink)
    : undefined;
}
