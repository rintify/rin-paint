import {ImageAsset} from '../image/ImageAsset';
import { RasterSurface } from '../raster/RasterSurface';
import type { LayerCommon, LayerType } from '../../model';
import { isLayerType } from '../../model';
import type { Layer } from '../layers';
import { makeCanvas } from '../layers';
import { commonForLayer } from '../parameters/common';
import { resolveCommonParameter, resolveKindParameter } from '../parameters/catalog';
import type { ParameterCatalog, ResolvedParameter } from '../parameters/types';
import { adjustLayerType } from './adjust';
import { clipLayerType } from './clip';
import {
  applyCommonRecord,
  commonRecordFrom,
  type LayerDefinition,
  type LayerProps,
  type LayerRecord,
  type LayerSnapshot,
} from './definition';
import { imageLayerType } from './image';
import { outlineLayerType } from './outline';
import { rasterLayerType } from './raster';
import { shapeLayerType } from './shape';
import { textLayerType } from './text';
import { canvasLayerType } from './canvas';
import { transformLayerType } from './transform';
import type {
  LayerContentEnv,
  LayerSnapshotEnv,
} from './types';

export type { LayerProps, LayerRecord, LayerSnapshot };

const definitions = {
  canvas: canvasLayerType,
  transform: transformLayerType,
  raster: rasterLayerType,
  adjust: adjustLayerType,
  outline: outlineLayerType,
  clip: clipLayerType,
  shape: shapeLayerType,
  text: textLayerType,
  image: imageLayerType,
} as const;

type Definitions = typeof definitions;

export function layerDefinition<K extends LayerType>(type: K): Definitions[K];
export function layerDefinition(type: LayerType): LayerDefinition<LayerType>;
export function layerDefinition(type: LayerType): LayerDefinition<LayerType> {
  return definitions[type] as never;
}

export function layerTypeHandler(type: LayerType): LayerDefinition<LayerType> {
  return layerDefinition(type) as never;
}

export function layerHandler(layer: Layer): LayerDefinition<LayerType> {
  return layerDefinition(layer.type) as never;
}

export function kindCatalog(layer: { type: LayerType; state: unknown }): ParameterCatalog<unknown> {
  const def = layerDefinition(layer.type);
  const catalog = typeof def.parameters === 'function'
    ? def.parameters(layer as never)
    : def.parameters;
  return catalog;
}

export function resolvedParameters(layer: LayerCommon & { type: LayerType; state: unknown }): ResolvedParameter[] {
  const def = layerDefinition(layer.type);
  const common = commonForLayer(def.info.supportsBlend).filter(item => layer.type !== 'transform' || item.id === 'visible').map(resolveCommonParameter);
  const catalog = kindCatalog(layer);
  return [...common, ...catalog.definitions.map(item => resolveKindParameter(item, layer.type))];
}

export function buildLayerSnapshot(layer: Layer, env: LayerSnapshotEnv): LayerSnapshot {
  const def = layerHandler(layer);
  const snapshot: LayerSnapshot = {
    id: layer.id,
    type: layer.type,
    common: commonRecordFrom(layer),
    ...(layer.type === 'canvas' ? {scope: {id: layer.id, children: layer.childIds.map(id => ({id, entityId: id}))}} : {}),
    unit: 'mm',
    state: def.codec.encode(layer.state as never),
  };
  if (!env.withContent) return snapshot;
  if (layer.type === 'raster') {
    snapshot.raster = layer.runtime.surface.snapshot();
    return snapshot;
  }
  if (layer.type === 'image') snapshot.image=layer.runtime.asset;
  return snapshot;
}

export async function restoreLayerFrom(
  source: LayerRecord | LayerSnapshot,
  env: LayerContentEnv,
  index = 0,
): Promise<Layer | null> {
  if (!isLayerType(source.type)) return null;
  const def = layerDefinition(source.type);
  const decoded = source.referenceOnly ? def.state.initial() : def.codec.decode(source.state);
  const state = decoded;
  if (!state && source.type !== 'raster' && source.type !== 'adjust' && source.type !== 'outline' && source.type !== 'clip') {
    return null;
  }
  const content=source.content;
  const runtime = source.type === 'image' && 'image' in source && source.image ? {asset:source.image}
    : source.type === 'image' && source.referenceOnly ? {asset:new ImageAsset(makeCanvas(1,1))}
    : source.type === 'raster' && 'raster' in source && source.raster
    ? {surface: new RasterSurface(source.raster.intrinsicPpi, source.raster)}
    : def.codec.decodeRuntime
    ? await def.codec.decodeRuntime(content, env)
    : undefined;
  if ((source.type === 'raster' || source.type === 'image') && !runtime) return null;
  const layer = {
    id: source.id,
    type: source.type,
    name: source.common.name ?? def.info.defaultName(index),
    opacity: source.common.opacity ?? 1,
    blend: source.common.blend ?? 'source-over',
    visible: source.common.visible ?? true,
    ...(source.type === 'canvas' ? {childIds: source.scope?.children.map(child => child.id) ?? []} : {}),
    linkRecovery: source.common.linkRecovery ? structuredClone(source.common.linkRecovery) : undefined,
    parameterLink: source.common.parameterLink ? structuredClone(source.common.parameterLink) : undefined,
    state: def.state.normalize((state ?? def.state.initial()) as never),
    runtime,
  } as Layer;
  return layer;
}

export async function savedLayerFrom(layer: Layer, _env: LayerContentEnv): Promise<LayerRecord> {
  const def = layerHandler(layer);
  return {
    id: layer.id,
    type: layer.type,
    common: commonRecordFrom(layer),
    ...(layer.type === 'canvas' ? {scope: {id: layer.id, children: layer.childIds.map(id => ({id, entityId: id}))}} : {}),
    unit: 'mm',
    state: def.codec.encode(layer.state as never),
    content: await def.codec.encodeContent?.(layer as never),
  };
}

export function layerTypeProps(layer: Layer): LayerProps {
  return { state: layerHandler(layer).state.clone(layer.state as never) };
}

export function objectTransformProps(layer: Layer): LayerProps {
  return layerHandler(layer).capabilities.objectTransform ? layerTypeProps(layer) : {};
}



export function canMaskLayerType(type: LayerType): boolean {
  return layerDefinition(type).info.canMask;
}

export function maskSourceLabel(type: LayerType): string {
  return layerDefinition(type).info.maskSourceLabel ?? '';
}

export function supportsBlendMode(type: LayerType): boolean {
  return layerDefinition(type).info.supportsBlend;
}

export function canTransformObjectType(type: LayerType): boolean {
  return !!layerDefinition(type).capabilities.objectTransform;
}

export function applyLayerProps(layer: Layer, props: LayerProps): void {
  if (props.name !== undefined) layer.name = props.name;
  if (props.opacity !== undefined) layer.opacity = props.opacity;
  if (props.blend !== undefined) layer.blend = props.blend;
  if (props.visible !== undefined) layer.visible = props.visible;
  if (props.parameterLink !== undefined) {
    layer.parameterLink = props.parameterLink ? structuredClone(props.parameterLink) : undefined;
  }
  if (props.state !== undefined) {
    layer.state = layerHandler(layer).state.applyPatch(layer.state as never, props.state as never);
  }
}

export function hostWithProps(layer: Layer, props: LayerProps): import('../parameters/host').ParameterHost {
  const next = {
    ...layer,
    state: layerHandler(layer).state.clone(layer.state as never),
  };
  applyLayerProps(next as Layer, structuredClone(props));
  next.parameterLink = layer.parameterLink;
  return next;
}

export function applyRecordProps(record: LayerRecord, props: LayerProps): void {
  if (props.name !== undefined) record.common.name = props.name;
  if (props.opacity !== undefined) record.common.opacity = props.opacity;
  if (props.blend !== undefined) record.common.blend = props.blend;
  if (props.visible !== undefined) record.common.visible = props.visible;
  if (props.parameterLink !== undefined) {
    record.common.parameterLink = props.parameterLink ? structuredClone(props.parameterLink) : undefined;
  }
  if (props.state !== undefined && isLayerType(record.type)) {
    const current = layerDefinition(record.type).codec.decode(record.state)
      ?? layerDefinition(record.type).state.initial();
    const next = layerDefinition(record.type).state.applyPatch(current as never, props.state as never);
    record.state = layerDefinition(record.type).codec.encode(next as never);
  }
}

export function remapRecordIds(record: LayerRecord, mapId: (id: string) => string | undefined): void {
  record.id = mapId(record.id) ?? record.id;
  if (record.scope) record.scope = {id: record.id, children: record.scope.children.flatMap(child => {
    const id = mapId(child.id), entityId = mapId(child.entityId);
    return id && entityId ? [{id, entityId}] : [];
  })};
  if (isLayerType(record.type) && layerDefinition(record.type).state.remapReferences) {
    const current = layerDefinition(record.type).codec.decode(record.state)
      ?? layerDefinition(record.type).state.initial();
    record.state = layerDefinition(record.type).codec.encode(
      layerDefinition(record.type).state.remapReferences!(current as never, mapId) as never,
    );
  }
}

export { applyCommonRecord, commonRecordFrom };
