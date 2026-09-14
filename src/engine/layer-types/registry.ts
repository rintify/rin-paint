import { transformLayerType } from './transform';
import { RasterSurface } from '../raster/RasterSurface';
import { RasterResampler } from '../raster/RasterResampler';
import type { LayerCommon, LayerType } from '../../model';
import { isLayerType } from '../../model';
import type { Layer } from '../layers';
import { makeCanvas } from '../layers';
import { commonForLayer } from '../parameters/common';
import {
  resolveCommonParameter,
  resolveKindParameter,
} from '../parameters/catalog';
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
import { rasterLayerType, scaleRasterRuntime } from './raster';
import { shapeLayerType } from './shape';
import { textLayerType } from './text';
import type { LoadResult } from '../schema';
import type {
  LayerContentEnv,
  LayerScaleEnv,
  LayerSnapshotEnv,
  LayerStoredScaleEnv,
} from './types';

export type { LayerProps, LayerRecord, LayerSnapshot };

const definitions = {
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

export interface ErasedLayerModule {
  type: string;
  kindId: string;
  revision: number;
  create(name: string, id?: string): Layer;
  initialState(): unknown;
  cloneState(state: unknown): unknown;
  loadState(raw: unknown): LoadResult<unknown>;
  encodeState(state: unknown): unknown;
  enumerateLayerIds(state: unknown): string[];
  enumerateAssetIds(layer: Layer): string[];
  enumerateContentAssetIds(content: unknown): string[];
  definition: LayerDefinition<LayerType>;
}

function erase<K extends LayerType>(def: LayerDefinition<K>): ErasedLayerModule {
  return {
    type: def.info.type,
    kindId: def.info.kindId,
    revision: def.info.revision,
    create: (name, id) => def.factory.create(name, id) as Layer,
    initialState: () => structuredClone(def.schema.createDefaults),
    cloneState: (state) => def.state.clone(state as never),
    loadState: (raw) => def.schema.load(raw),
    encodeState: (state) => def.codec.encode(state as never),
    enumerateLayerIds: (state) => def.enumerateLayerIds?.(state as never) ?? [],
    enumerateAssetIds: (layer) => def.enumerateAssetIds?.(layer as never) ?? [],
    enumerateContentAssetIds: (content) => {
      if (!content || typeof content !== 'object' || !('tiles' in content)) return [];
      const tiles = (content as { tiles?: Array<{ assetId?: string }> }).tiles;
      return tiles?.map((tile) => tile.assetId).filter((id): id is string => !!id) ?? [];
    },
    definition: def as never,
  };
}

const erasedBuiltins = Object.fromEntries(
  Object.values(definitions).map((def) => [def.info.type, erase(def as never)]),
) as Record<string, ErasedLayerModule>;
const extraModules = new Map<string, ErasedLayerModule>();

export function findLayerModule(typeOrKindId: string): ErasedLayerModule | undefined {
  const builtin = erasedBuiltins[typeOrKindId];
  if (builtin) return builtin;
  const byKind = Object.values(erasedBuiltins).find((mod) => mod.kindId === typeOrKindId);
  if (byKind) return byKind;
  return extraModules.get(typeOrKindId)
    ?? [...extraModules.values()].find((mod) => mod.kindId === typeOrKindId || mod.type === typeOrKindId);
}

export function registerLayerModule(module: ErasedLayerModule): void {
  extraModules.set(module.kindId, module);
}

export function unregisterLayerModule(kindId: string): void {
  extraModules.delete(kindId);
}

export function createLayer(type: LayerType, name: string, id?: string): Layer {
  return layerDefinition(type).factory.create(name, id) as Layer;
}

export function addMenuItems(group: 'raster' | 'effect'): Array<{
  type: LayerType;
  label: string;
  historyLabel: string;
}> {
  return Object.values(definitions).flatMap((def) =>
    def.info.addMenu?.group === group
      ? [{ type: def.info.type, label: def.info.addMenu.label, historyLabel: def.info.addMenu.historyLabel }]
      : [],
  );
}

export function layerDefinition<K extends LayerType>(type: K): Definitions[K];
export function layerDefinition(type: LayerType): LayerDefinition<LayerType>;
export function layerDefinition(type: LayerType): LayerDefinition<LayerType> {
  return definitions[type] as never;
}

export function layerTypeHandler(type: LayerType): LayerDefinition<LayerType> {
  return (findLayerModule(type)?.definition ?? layerDefinition(type)) as LayerDefinition<LayerType>;
}

export function layerHandler(layer: Layer): LayerDefinition<LayerType> {
  return (findLayerModule(layer.type)?.definition ?? layerDefinition(layer.type)) as LayerDefinition<LayerType>;
}

export function kindCatalog(layer: {
  type: LayerType;
  state: unknown;
}): ParameterCatalog<unknown> {
  const def = layerDefinition(layer.type);
  const catalog =
    typeof def.parameters === 'function'
      ? def.parameters(layer as never)
      : def.parameters;
  return catalog;
}

export function resolvedParameters(
  layer: LayerCommon & { type: LayerType; state: unknown },
): ResolvedParameter[] {
  const def = layerDefinition(layer.type);
  const common = commonForLayer(def.info.supportsBlend).map(
    resolveCommonParameter,
  );
  const catalog = kindCatalog(layer);
  return [
    ...common,
    ...catalog.definitions.map((item) =>
      resolveKindParameter(item, layer.type),
    ),
  ];
}

export function buildLayerSnapshot(
  layer: Layer,
  env: LayerSnapshotEnv,
): LayerSnapshot {
  const def = layerHandler(layer);
  const snapshot: LayerSnapshot = {
    id: layer.id,
    type: layer.type,
    kindId: def.info.kindId,
    revision: def.info.revision,
    common: commonRecordFrom(layer),
    state: def.codec.encode(layer.state as never),
  };
  if (!env.withContent) return snapshot;
  if (layer.type === 'raster') {
    snapshot.content = layer.runtime.surface.snapshot();
    return snapshot;
  }
  if (layer.type === 'image') {
    const source = layer.runtime.canvas;
    const copy = makeCanvas(source.width, source.height);
    copy.getContext('2d')!.drawImage(source, 0, 0);
    snapshot.canvas = copy;
    if (env.keepCanvas) return snapshot;
    void (async () => {
      snapshot.content = await def.codec.encodeContent?.(layer as never);
      snapshot.canvas = undefined;
      env.onEncoded();
    })();
  }
  return snapshot;
}

export function inspectLayerRecord(source: LayerRecord | LayerSnapshot): LoadResult<unknown> {
  const mod = findLayerModule(source.kindId || source.type);
  if (!mod) {
    return {
      status: 'unsupported',
      reason: `未知のレイヤー種類です: ${source.kindId || source.type}`,
      raw: source,
    };
  }
  return mod.loadState(source.state);
}

export async function restoreLayerFrom(
  source: LayerRecord | LayerSnapshot,
  env: LayerContentEnv,
  index = 0,
): Promise<Layer | null> {
  const mod = findLayerModule(source.kindId || source.type);
  if (!mod || !isLayerType(mod.type)) return null;
  const def = layerDefinition(mod.type);
  const loaded = def.schema.load(source.state);
  if (loaded.status !== 'ok') return null;
  const content =
    'canvas' in source && source.canvas ? source.canvas : source.content;
  const runtime = def.codec.decodeRuntime
    ? await def.codec.decodeRuntime(content, env)
    : undefined;
  if (def.codec.decodeRuntime && !runtime) return null;
  const layer = {
    id: source.id,
    type: mod.type,
    name: source.common.name ?? def.info.defaultName(index),
    opacity: source.common.opacity ?? 1,
    blend: source.common.blend ?? 'source-over',
    visible: source.common.visible ?? true,
    parentId: source.common.parentId,
    childIds: [...source.common.childIds],
    parameterLink: source.common.parameterLink
      ? structuredClone(source.common.parameterLink)
      : undefined,
    state: def.state.normalize(loaded.value as never),
    runtime,
  } as Layer;
  return layer;
}

export async function savedLayerFrom(
  layer: Layer,
  _env: LayerContentEnv,
): Promise<LayerRecord> {
  const def = layerHandler(layer);
  return {
    id: layer.id,
    type: layer.type,
    kindId: def.info.kindId,
    revision: def.info.revision,
    common: commonRecordFrom(layer),
    state: def.codec.encode(layer.state as never),
    content: await def.codec.encodeContent?.(layer as never),
  };
}

export function layerTypeProps(layer: Layer): LayerProps {
  return { state: layerHandler(layer).state.clone(layer.state as never) };
}

export function objectTransformProps(layer: Layer): LayerProps {
  return layerHandler(layer).capabilities.objectTransform
    ? layerTypeProps(layer)
    : {};
}

export function scaleLayer(
  layer: Layer,
  factor: number,
  env: LayerScaleEnv,
): void {
  const def = layerHandler(layer);
  layer.state = def.state.scale(layer.state as never, factor, env);
  if (layer.type === 'raster')
    scaleRasterRuntime(layer, factor, env.width, env.height);
}

export async function scaleLayerAsync(
  layer: Layer,
  factor: number,
  env: LayerScaleEnv,
): Promise<void> {
  if (layer.type !== 'raster') {
    scaleLayer(layer, factor, env);
    return;
  }
  if (factor !== 1)
    layer.runtime.surface = await RasterResampler.scaleAsync(
      layer.runtime.surface,
      factor,
    );
}

export async function scaleStoredLayer(
  source: LayerRecord | LayerSnapshot,
  env: LayerStoredScaleEnv,
): Promise<void> {
  if (!isLayerType(source.type)) return;
  const def = layerDefinition(source.type);
  if (def.codec.scaleStored)
    source.state = def.codec.scaleStored(source.state, env);
  if (
    source.type === 'raster' &&
    source.content &&
    !(source.content instanceof Blob)
  ) {
    if (env.factor !== 1)
      source.content = (
        await RasterResampler.scaleAsync(
          await RasterSurface.restore(source.content),
          env.factor,
        )
      ).snapshot();
  }
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
    layer.parameterLink = props.parameterLink
      ? structuredClone(props.parameterLink)
      : undefined;
  }
  if (props.state !== undefined) {
    layer.state = layerHandler(layer).state.applyPatch(
      layer.state as never,
      props.state as never,
    );
  }
}

export function hostWithProps(
  layer: Layer,
  props: LayerProps,
): import('../parameters/host').ParameterHost {
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
    record.common.parameterLink = props.parameterLink
      ? structuredClone(props.parameterLink)
      : undefined;
  }
  if (props.state !== undefined && isLayerType(record.type)) {
    const current =
      layerDefinition(record.type).codec.decode(record.state) ??
      layerDefinition(record.type).state.initial();
    const next = layerDefinition(record.type).state.applyPatch(
      current as never,
      props.state as never,
    );
    record.state = layerDefinition(record.type).codec.encode(next as never);
  }
}

export function remapRecordIds(
  record: LayerRecord,
  mapId: (id: string) => string | undefined,
): void {
  record.id = mapId(record.id) ?? record.id;
  record.common.parentId = record.common.parentId
    ? (mapId(record.common.parentId) ?? null)
    : null;
  record.common.childIds = record.common.childIds
    .map((id) => mapId(id))
    .filter((id): id is string => !!id);
  if (
    isLayerType(record.type) &&
    layerDefinition(record.type).state.remapReferences
  ) {
    const current =
      layerDefinition(record.type).codec.decode(record.state) ??
      layerDefinition(record.type).state.initial();
    record.state = layerDefinition(record.type).codec.encode(
      layerDefinition(record.type).state.remapReferences!(
        current as never,
        mapId,
      ) as never,
    );
  }
}

export { applyCommonRecord, commonRecordFrom };
