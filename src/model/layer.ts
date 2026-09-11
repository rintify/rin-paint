import type { AdjustParams } from './adjust';
import type { BlendMode } from './blend';
import type { ShapeParams } from './shape';
import type { TextParams } from './text';

export type LayerType = 'raster' | 'adjust' | 'shape' | 'text';

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
  maskLayerIds?: string[];
  shape?: ShapeParams;
  snapEnabled?: boolean;
  text?: TextParams;
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
