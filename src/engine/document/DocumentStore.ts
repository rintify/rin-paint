import type { LayerAddress } from '../../model';
import type { LayerCommonRecord } from '../../model';
import type { Layer } from '../layers';
import { commonRecordFrom } from '../layer-types/definition';
import { findLayerModule } from '../layer-types/registry';
import type { DocumentMeta, LayerOwned, PageOwned, ProjectOpenMode } from './types';
import { addrKey } from './types';
import { HISTORY_VERSION } from '../persistence/version';

function cloneOwned(layer: LayerOwned): LayerOwned {
  return {
    ...layer,
    common: structuredClone(layer.common),
    state: structuredClone(layer.state),
    content: layer.content,
  };
}

export function ownedFromLive(layer: Layer): LayerOwned {
  const mod = findLayerModule(layer.type);
  return {
    id: layer.id,
    type: layer.type,
    kindId: mod?.kindId ?? `rin.layer.${layer.type}`,
    revision: mod?.revision ?? 1,
    common: commonRecordFrom(layer),
    state: mod ? mod.cloneState(layer.state) : structuredClone(layer.state),
  };
}

export class DocumentStore {
  meta: DocumentMeta = { pageOrder: [], activePageId: '', fonts: [] };
  mode: ProjectOpenMode = 'edit';
  reasons: string[] = [];
  originalBytes?: ArrayBuffer;
  private pages = new Map<string, PageOwned>();

  clear(): void {
    this.meta = { pageOrder: [], activePageId: '', fonts: [] };
    this.mode = 'edit';
    this.reasons = [];
    this.originalBytes = undefined;
    this.pages.clear();
  }

  getPage(id: string): PageOwned | undefined {
    return this.pages.get(id);
  }

  setPage(page: PageOwned): void {
    this.pages.set(page.id, page);
    this.updateOpenMode();
  }

  removePage(id: string): void {
    this.pages.delete(id);
    this.meta.pageOrder = this.meta.pageOrder.filter((pageId) => pageId !== id);
  }

  allPages(): PageOwned[] {
    return this.meta.pageOrder.flatMap((id) => {
      const page = this.pages.get(id);
      return page ? [page] : [];
    });
  }

  getLayer(address: LayerAddress): LayerOwned | undefined {
    const page = this.pages.get(address.pageId);
    return page?.layers.find((layer) => layer.id === address.layerId);
  }

  setLayer(address: LayerAddress, layer: LayerOwned): void {
    const page = this.pages.get(address.pageId);
    if (!page) return;
    const index = page.layers.findIndex((item) => item.id === address.layerId);
    const next = cloneOwned(layer);
    if (index < 0) page.layers.push(next);
    else page.layers[index] = next;
  }

  captureActive(args: {
    pageId: string;
    spec: PageOwned['spec'];
    rootLayerIds: string[];
    activeLayerId: string;
    layers: Layer[];
    history?: PageOwned['history'];
    view: PageOwned['view'];
    thumbnailVersion: number;
    thumbnail?: Blob;
    contents?: Map<string, LayerOwned['content']>;
  }): void {
    const previous = this.pages.get(args.pageId);
    this.pages.set(args.pageId, {
      id: args.pageId,
      spec: { ...args.spec },
      rootLayerIds: [...args.rootLayerIds],
      activeLayerId: args.activeLayerId,
      layers: args.layers.map((layer) => {
        const owned = ownedFromLive(layer);
        const content = args.contents?.get(layer.id) ?? previous?.layers.find((item) => item.id === layer.id)?.content;
        return content ? { ...owned, content } : owned;
      }),
      history: args.history ?? previous?.history ?? {
        version: HISTORY_VERSION,
        nodes: [{ id: 0, label: '', op: null, parentId: null, childIds: [], lastChild: 0 }],
        rootId: 0,
        currentId: 0,
      },
      view: { ...args.view },
      thumbnailVersion: args.thumbnailVersion,
      thumbnail: args.thumbnail ?? previous?.thumbnail,
      status: previous?.status ?? 'ok',
      reasons: previous?.reasons ?? [],
      raw: previous?.raw,
    });
    this.meta.activePageId = args.pageId;
  }

  replaceAll(meta: DocumentMeta, pages: PageOwned[]): void {
    this.meta = {
      pageOrder: [...meta.pageOrder],
      activePageId: meta.activePageId,
      fonts: structuredClone(meta.fonts),
    };
    this.pages.clear();
    for (const page of pages) this.pages.set(page.id, page);
    this.updateOpenMode();
  }

  private updateOpenMode(): void {
    const pages = [...this.pages.values()];
    this.reasons = pages.flatMap(page => page.reasons);
    this.mode = pages.some(page => page.status !== 'ok') ? 'view-only' : 'edit';
  }

  ppiOf(pageId: string, fallback: number): number {
    return this.pages.get(pageId)?.spec.ppi ?? fallback;
  }

  key(address: LayerAddress): string {
    return addrKey(address);
  }
}

export function commonFromOwned(common: LayerCommonRecord, id: string) {
  return {
    id,
    name: common.name,
    opacity: common.opacity,
    blend: common.blend,
    visible: common.visible,
    parentId: common.parentId,
    childIds: [...common.childIds],
    ...(common.parameterLink
      ? { parameterLink: structuredClone(common.parameterLink) }
      : {}),
  };
}
