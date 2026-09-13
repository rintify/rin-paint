import { useStore } from '../../state/store';
import { flattenHierarchy, layerItem, type HierarchyItem, type ScopedLayerAddress } from '../../model';
import { HistoryTree } from '../history/historyTree';
import { remapRecordIds, restoreLayerFrom, savedLayerFrom } from '../layer-types/registry';
import { canvasToBlob } from '../layers';
import { deleteBinItem, loadBinItem, loadBinItems, loadPage, loadProjectMeta, saveBinItem, savePage, type SavedBinItem, type SavedLayer } from '../persistence/db';
import type { PaintEngine } from '../PaintEngine';
import { scopedAddressKey } from '../../model/document';
import { hydrateDocumentRecords, savedCanvasScopePath } from '../entities/linkedRecords';

/** Owns modeless-bin assets and switches the active document/history. */
export class BinService {
  items: SavedBinItem[] = [];
  activeBinId: string | null = null;

  constructor(private engine: PaintEngine) {}

  async init(): Promise<void> {
    this.items = await loadBinItems();
    this.syncStore();
  }

  reset(): void {
    this.items = [];
    this.activeBinId = null;
    this.syncStore();
  }

  async putLayer(layerId: string): Promise<void> {
    if (this.activeBinId || this.engine.isBusy()) return;
    const layer = this.engine.layerService.byId(layerId);
    if (!layer) return;
    const stack = this.engine.layerService.stackForLayer(layerId);
    const roots = stack?.layerIds ?? [layerId];
    const ids = [...new Set(roots.flatMap(id => this.engine.layerService.descendantIds(id)))];
    const layers = await Promise.all(ids.map(id => savedLayerFrom(this.engine.layerService.byId(id)!, { pageFrame: this.engine.pageFrame, ppi: this.engine.getPageSpec().ppi })));
    const history = new HistoryTree();
    const item: SavedBinItem = {
      id: `B${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
      name: layer.name,
      hierarchy: stack ? [structuredClone(stack)] : [layerItem(layerId)],
      layers,
      activeLayerId: layerId,
      history: await history.serialize(canvasToBlob),
      ppi: this.engine.getPageSpec().ppi,
      visible: true,
    };
    this.items.push(item);
    await saveBinItem(item);
    const ops: import('../history/historyTree').AtomicOp[] = [];
    const instanceId = crypto.randomUUID();
    for (const id of ids) {
      const linked = this.engine.layerService.byId(id);
      if (!linked) continue;
      const source: ScopedLayerAddress = { document: { kind: 'bin', id: item.id }, scopePath: this.scopePath(id), nodeId: id };
      const before = linked.dataLink ? structuredClone(linked.dataLink) : null;
      const beforeInstanceId = linked.dataLinkInstanceId;
      const beforeStructureSource = linked.canvasStructureSource ? structuredClone(linked.canvasStructureSource) : undefined;
      linked.dataLink = structuredClone(source);
      linked.dataLinkInstanceId = instanceId;
      linked.canvasStructureSource = source.scopePath.length ? structuredClone(source) : undefined;
      ops.push({
        kind: 'layerDataLink', layerId: id, before, after: source, beforeInstanceId, afterInstanceId: instanceId,
        beforeStructureSource, afterStructureSource: linked.canvasStructureSource,
      });
    }
    if (ops.length) this.engine.history.push(ops.length === 1 ? ops[0] : { kind: 'batch', ops }, 'ビンへ移動');
    for (const id of ids) {
      const sourceAddress: ScopedLayerAddress = { document: { kind: 'bin', id: item.id }, scopePath: this.scopePath(id), nodeId: id };
      const pageAddress = this.engine.entities.addressFor(id);
      try {
        if (!this.engine.entities.repo.occurrences.has(scopedAddressKey(sourceAddress))) {
          const record = layers.find(layer => layer.id === id);
          if (record) this.engine.entities.repo.createOwned(sourceAddress, record);
        }
        const pageId = scopedAddressKey(pageAddress);
        if (this.engine.entities.repo.occurrences.has(pageId)) {
          this.engine.entities.repo.adoptAsLink(pageId, scopedAddressKey(sourceAddress));
        } else {
          this.engine.entities.repo.createLink(pageAddress, scopedAddressKey(sourceAddress));
        }
      } catch { /* Persistence rebuilds the shared index from saved documents. */ }
    }
    this.engine.committed(false);
    this.syncStore();
  }

  /** Place linked occurrences from a bin asset. The bin remains the owner. */
  async place(id: string): Promise<void> {
    if (this.engine.isBusy()) return;
    if (this.activeBinId) await this.returnToPage();
    const item = await loadBinItem(id);
    if (!item) throw new Error('ビン項目を読み込めませんでした');
    const service = this.engine.layerService;
    const instanceId = crypto.randomUUID();
    const idMap = new Map(item.layers.map(record => [record.id, `${record.id}-${crypto.randomUUID().slice(0, 8)}`]));
    const mapId = (sourceId: string) => idMap.get(sourceId);
    const records = item.layers.map(source => {
      const record = structuredClone(source) as SavedLayer;
      remapRecordIds(record, mapId);
      record.dataLink = {
        document: { kind: 'bin', id: item.id },
        scopePath: this.savedScopePath(source.id, item.layers),
        nodeId: source.id,
      };
      record.dataLinkInstanceId = instanceId;
      record.canvasStructureSource = record.dataLink.scopePath.length ? structuredClone(record.dataLink) : undefined;
      return record;
    });
    const beforeHierarchy = structuredClone(service.rootHierarchy);
    const placedHierarchy = this.remapHierarchy(item.hierarchy, mapId);
    const restored = [] as import('../layers').Layer[];
    for (const record of records) {
      const layer = await restoreLayerFrom(record, { pageFrame: this.engine.pageFrame, ppi: this.engine.getPageSpec().ppi });
      if (layer) { service.layers.push(layer); restored.push(layer); }
    }
    service.rootHierarchy = [...service.rootHierarchy, ...placedHierarchy];
    service.rebuildScopePlacements();
    const operations: import('../history/historyTree').AtomicOp[] = restored.map(layer => ({
      kind: 'layerAdd', location: service.locationOf(layer.id) ?? { scopeId: null, index: service.rootLayerIds.length },
      snapshot: service.snapshotLayer(layer, true),
    }));
    operations.push({ kind: 'hierarchyChange', scopeId: null, before: beforeHierarchy, after: structuredClone(service.rootHierarchy) });
    const first = flattenHierarchy(placedHierarchy)[0];
    if (first) service.activeLayerId = first;
    this.engine.history.push({ kind: 'batch', ops: operations }, 'ビンからリンク配置');
    this.engine.committed();
  }

  async open(id: string): Promise<void> {
    if (this.activeBinId === id || this.engine.isBusy()) return;
    await this.engine.flushSavePublic();
    const item = await loadBinItem(id);
    if (!item) throw new Error('ビン項目を読み込めませんでした');
    this.engine.setBusy(true);
    try {
      const service = this.engine.layerService;
      service.layers = [];
      const hydrated = hydrateDocumentRecords(item.layers, this.items);
      for (const record of hydrated) {
        const layer = await restoreLayerFrom(record, { pageFrame: this.engine.pageFrame, ppi: this.engine.getPageSpec().ppi });
        if (layer) service.layers.push(layer);
      }
      service.rootLayerIds = flattenHierarchy(item.hierarchy);
      service.rootHierarchy = structuredClone(item.hierarchy);
      service.rebuildScopePlacements();
      service.activeLayerId = item.activeLayerId;
      service.fixActive();
      this.centerEditorViewport();
      this.engine.history = new HistoryTree();
      this.engine.history.restore(item.history);
      this.activeBinId = id;
      useStore.getState().set({
        editingDocument: { kind: 'bin', id }, textEditingId: null,
        selectedLayerIds: service.activeLayerId ? [service.activeLayerId] : [], multiSelectMode: false,
      });
      this.engine.events.emit('projectReset');
      this.engine.view.reset();
      this.engine.requestRender();
      this.engine.syncStore();
    } finally { this.engine.setBusy(false); }
  }

  async saveActive(): Promise<void> {
    if (!this.activeBinId) return;
    const index = this.items.findIndex(item => item.id === this.activeBinId);
    if (index < 0) return;
    const service = this.engine.layerService;
    const item: SavedBinItem = {
      ...this.items[index],
      name: service.byId(service.rootLayerIds[0])?.name ?? this.items[index].name,
      hierarchy: structuredClone(service.rootHierarchy),
      layers: await Promise.all(service.layers.map(layer => savedLayerFrom(layer, { pageFrame: this.engine.pageFrame, ppi: this.engine.getPageSpec().ppi }))),
      activeLayerId: service.activeLayerId,
      history: await this.engine.history.serialize(canvasToBlob),
      ppi: this.engine.getPageSpec().ppi,
    };
    this.items[index] = item;
    await saveBinItem(item);
    await this.engine.entities.persist();
    this.syncStore();
  }

  async returnToPage(): Promise<void> {
    if (!this.activeBinId || this.engine.isBusy()) return;
    await this.saveActive();
    const page = await loadPage(this.engine.pages.activePageId);
    if (!page) throw new Error('ページを読み込めませんでした');
    this.engine.setBusy(true);
    try {
      this.activeBinId = null;
      this.engine.pageFrame.setOrigin(0, 0);
      useStore.getState().set({
        editingDocument: { kind: 'page', id: page.id }, textEditingId: null,
        selectedLayerIds: page.activeLayerId ? [page.activeLayerId] : [], multiSelectMode: false,
      });
      await this.engine.restoreSavedPagePublic(page);
      this.engine.events.emit('projectReset');
      this.engine.requestRender();
      this.engine.syncStore();
    } finally { this.engine.setBusy(false); }
  }

  async remove(id: string): Promise<void> {
    if (this.activeBinId === id) await this.returnToPage();
    await this.materializeLinksFromDeletedBin(id);
    if (!this.activeBinId) {
      for (const layer of this.engine.layerService.layers) {
        const address = layer.dataLink ?? layer.canvasStructureSource;
        if (address?.document.kind !== 'bin' || address.document.id !== id) continue;
        delete layer.dataLink;
        delete layer.dataLinkInstanceId;
        delete layer.canvasStructureSource;
      }
      this.engine.syncStore();
    }
    this.items = this.items.filter(item => item.id !== id);
    await deleteBinItem(id);
    await this.engine.entities.persist();
    this.syncStore();
  }

  private syncStore(): void {
    useStore.getState().set({ binItems: this.items.map(item => ({ id: item.id, name: item.name, visible: item.visible })) });
  }

  private centerEditorViewport(): void {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const layer of this.engine.layerService.layers) {
      let bounds: { x: number; y: number; w: number; h: number } | null = null;
      if (layer.type === 'raster') bounds = layer.runtime.sparse?.contentBoundsDocumentPx(this.engine.getPageSpec().ppi) ?? null;
      else if (layer.type === 'shape' || layer.type === 'image' || layer.type === 'text') bounds = this.engine.objectBounds(layer.id);
      if (!bounds) continue;
      left = Math.min(left, bounds.x); top = Math.min(top, bounds.y);
      right = Math.max(right, bounds.x + bounds.w); bottom = Math.max(bottom, bounds.y + bounds.h);
    }
    if (!Number.isFinite(left)) this.engine.pageFrame.setOrigin(0, 0);
    else this.engine.pageFrame.setOrigin(
      (left + right - this.engine.pageFrame.w) / 2,
      (top + bottom - this.engine.pageFrame.h) / 2,
    );
  }

  private scopePath(layerId: string): string[] {
    const path: string[] = [];
    let layer = this.engine.layerService.byId(layerId);
    while (layer?.scopeId) {
      path.unshift(layer.scopeId);
      layer = this.engine.layerService.byId(layer.scopeId);
    }
    return path;
  }

  private savedScopePath(layerId: string, records: SavedLayer[]): string[] {
    return savedCanvasScopePath(layerId, records);
  }

  private remapHierarchy(items: readonly HierarchyItem[], mapId: (id: string) => string | undefined): HierarchyItem[] {
    return items.flatMap<HierarchyItem>(item => {
      if (item.kind === 'layer') {
        const layerId = mapId(item.layerId);
        return layerId ? [{ ...item, id: crypto.randomUUID(), layerId }] : [];
      }
      const layerIds = item.layerIds.map(mapId).filter((value): value is string => !!value);
      return layerIds.length >= 2
        ? [{ ...item, id: `stack-${crypto.randomUUID()}`, layerIds }]
        : layerIds.map(layerId => layerItem(layerId));
    });
  }

  private async materializeLinksFromDeletedBin(binId: string): Promise<void> {
    const sourceItem = await loadBinItem(binId);
    const sourceById = new Map(sourceItem?.layers.map(layer => [layer.id, layer]) ?? []);
    const meta = await loadProjectMeta();
    if (meta) {
      for (const pageId of meta.pageOrder) {
        const page = await loadPage(pageId);
        if (!page) continue;
        let changed = false;
        page.layers = page.layers.map(layer => {
          const address = layer.dataLink ?? layer.canvasStructureSource;
          if (address?.document.kind !== 'bin' || address.document.id !== binId) return layer;
          changed = true;
          const source = sourceById.get(address.nodeId);
          if (!source) return { ...layer, dataLink: undefined, dataLinkInstanceId: undefined, canvasStructureSource: undefined };
          const owned = structuredClone(source);
          owned.id = layer.id;
          owned.dataLink = undefined;
          owned.dataLinkInstanceId = undefined;
          owned.canvasStructureSource = undefined;
          return owned;
        });
        if (changed) await savePage(page);
      }
    }
    for (const bin of await loadBinItems()) {
      if (bin.id === binId) continue;
      let changed = false;
      bin.layers = bin.layers.map(layer => {
        const address = layer.dataLink ?? layer.canvasStructureSource;
        if (address?.document.kind !== 'bin' || address.document.id !== binId) return layer;
        changed = true;
        const source = sourceById.get(address.nodeId);
        if (!source) return { ...layer, dataLink: undefined, dataLinkInstanceId: undefined, canvasStructureSource: undefined };
        const owned = structuredClone(source);
        owned.id = layer.id;
        owned.dataLink = undefined;
        owned.dataLinkInstanceId = undefined;
        owned.canvasStructureSource = undefined;
        return owned;
      });
      if (changed) await saveBinItem(bin);
    }
  }
}
