import type { LayerAddress, PageSpec, ProjectFont } from '../../model';
import type { PersistedHistory } from '../history/historyTree';
import type { LayerCommonRecord } from '../../model';
import type { StoredRasterContent } from '../raster/RasterAssetRepository';
import type { ViewState } from '../view';
import type { LoadResult } from '../schema';

export interface LayerOwned {
  id: string;
  type: string;
  kindId: string;
  revision: number;
  common: LayerCommonRecord;
  state: unknown;
  content?: Blob | StoredRasterContent;
}

export interface PageOwned {
  id: string;
  spec: PageSpec;
  rootLayerIds: string[];
  activeLayerId: string;
  layers: LayerOwned[];
  history: PersistedHistory;
  view: ViewState;
  thumbnailVersion: number;
  thumbnail?: Blob;
  status: LoadResult<unknown>['status'];
  reasons: string[];
  /** 未対応・原本保存用。正規化せず保持する。 */
  raw?: unknown;
}

export interface DocumentMeta {
  pageOrder: string[];
  activePageId: string;
  fonts: ProjectFont[];
}

export type ProjectOpenMode = 'edit' | 'view-only';

export function addrKey(address: LayerAddress): string {
  return `${address.pageId}:${address.layerId}`;
}
