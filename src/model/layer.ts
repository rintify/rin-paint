import type { AdjustParams } from './adjust';
import type { BlendMode } from './blend';
import type { OutlineParams } from './outline';
import type { ShapeParams } from './shape';
import type { TextParams } from './text';

export type LayerType = 'raster' | 'adjust' | 'outline' | 'clip' | 'shape' | 'text';

export interface LayerAddress {
  pageId: string;
  layerId: string;
}

export type SemanticParameterValue = number | string | boolean | null;

/** One upstream layer plus the individual semantic parameters still following it. */
export interface LayerParameterLink {
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

/** React 側に渡すレイヤーの読み取り専用メタデータ */
export interface LayerMeta {
  id: string;
  type: LayerType;
  name: string;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  parentId: string | null;
  childIds: string[];
  params?: AdjustParams;
  outline?: OutlineParams;
  maskLayerIds?: string[];
  shape?: ShapeParams;
  snapEnabled?: boolean;
  text?: TextParams;
  parameterLink?: LayerParameterLink;
  linkSource?: LayerLinkEndpointSummary;
  directLinkTargets?: LayerLinkEndpointSummary[];
  compatibleLinkParameterIds?: string[];
  /** ラスター内容が変わるたびに増える (サムネイル再描画用) */
  version: number;
  canMergeDown: boolean;
  canRemove: boolean;
  canTransferShape: boolean;
}

export interface PageMeta {
  id: string;
  thumbnailVersion: number;
}
