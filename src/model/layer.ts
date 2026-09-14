import type { BlendMode } from './blend';
import type { LayerCommon, LayerKindMap, LayerType } from './layerKind';

export type { LayerType } from './layerKind';
export * from './layerKind';

export interface LayerAddress {
  document: import("./document/types").DocumentKey;
  layerId: string;
}

export type SemanticParameterValue = number | string | boolean | null;

/** One upstream layer plus the individual semantic parameters still following it. */
export interface LayerParameterLink {
  structure?: {inherited: Record<string, string>; suppressed: string[]; placements: {id: string; index: number}[]};
  linkedContent?: boolean;
  linkedState?: boolean;
  linkedName?: boolean;
  stateOverrides?: Record<string, {value?: unknown; remove?: true}>;
  source: LayerAddress;
  sourceNameHint: string;
  sourcePageIndexHint: number;
  linkedParameterIds: string[];
  fallbackValues: Record<string, SemanticParameterValue>;
}

export interface LayerLinkEndpointSummary {
  address: LayerAddress;
  name: string;
  pageIndex: number;
  linkedCount: number;
  missing?: boolean;
}

interface LayerMetaFlags {
  childIds: string[];
  /** Derived presentation location; never an entity property. */
  parentId: string | null;
  linkSource?: LayerLinkEndpointSummary;
  directLinkTargets?: LayerLinkEndpointSummary[];
  compatibleLinkParameterIds?: string[];
  /** ラスター内容が変わるたびに増える (サムネイル再描画用) */
  version: number;
  canMergeDown: boolean;
  canRemove: boolean;
  canTransferShape: boolean;
}

export type LayerMeta = {
  [K in LayerType]: LayerCommon & LayerMetaFlags & {
    type: K;
    state: LayerKindMap[K]['state'];
  }
}[LayerType];

export interface PageMeta {
  id: string;
  thumbnailVersion: number;
}

export function cloneLayerCommon(layer: LayerCommon): LayerCommon {
  return {
    id: layer.id,
    name: layer.name,
    opacity: layer.opacity,
    blend: layer.blend,
    visible: layer.visible,
    ...(layer.linkRecovery ? {linkRecovery: structuredClone(layer.linkRecovery)} : {}),
    ...(layer.parameterLink ? { parameterLink: structuredClone(layer.parameterLink) } : {}),
  };
}

export function defaultLayerCommon(id: string, name: string): LayerCommon {
  return {
    id,
    name,
    opacity: 1,
    blend: 'source-over',
    visible: true,
  };
}

export function isBlendMode(value: unknown): value is BlendMode {
  return value === 'source-over'
    || value === 'multiply'
    || value === 'screen'
    || value === 'overlay'
    || value === 'darken'
    || value === 'lighten'
    || value === 'lighter'
    || value === 'difference';
}
