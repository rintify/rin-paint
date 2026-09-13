import { scopedAddressKey, type DocumentAddress, type ScopedLayerAddress } from '../../model/document';
import type { SavedBinItem, SavedLayer, SavedPage, SavedSharedLayerEntity } from '../persistence/db';
import {
  loadBinItems,
  loadPage,
  loadProjectMeta,
  replaceSharedLayerEntities,
} from '../persistence/db';
import { savedCanvasScopePath } from './linkedRecords';
import { LayerEntityRepository, type LayerEntityRepositorySnapshot } from './LayerEntityRepository';
import type { PaintEngine } from '../PaintEngine';

function entityRecord(layer: SavedLayer): SavedLayer {
  const { placement: _placement, dataLink: _dataLink, dataLinkInstanceId: _instance, canvasStructureSource: _structure, ...record } = layer;
  return structuredClone(record);
}

/** Rebuilds the shared-entity index from saved documents so pages never store replicas. */
export class LayerEntityStore {
  readonly repo = new LayerEntityRepository<SavedLayer>();

  constructor(private engine: PaintEngine) {}

  reset(): void {
    this.repo.restore({ entities: [], occurrences: [], canvasStructures: [] });
  }

  document(): DocumentAddress {
    return this.engine.bins.activeBinId
      ? { kind: 'bin', id: this.engine.bins.activeBinId }
      : { kind: 'page', id: this.engine.pages.activePageId };
  }

  addressFor(layerId: string, document = this.document(), records?: readonly SavedLayer[]): ScopedLayerAddress {
    return {
      document,
      scopePath: records
        ? savedCanvasScopePath(layerId, records)
        : this.liveScopePath(layerId),
      nodeId: layerId,
    };
  }

  occurrenceId(address: ScopedLayerAddress): string {
    return scopedAddressKey(address);
  }

  cow(layerId: string): void {
    const id = this.occurrenceId(this.addressFor(layerId));
    if (!this.repo.occurrences.has(id)) return;
    this.repo.edit(id, () => undefined);
  }

  deleteOccurrence(address: ScopedLayerAddress): void {
    const id = this.occurrenceId(address);
    if (!this.repo.occurrences.has(id)) return;
    const entityId = this.repo.occurrences.get(id)?.entityId;
    if (entityId) this.repo.retainForHistory(entityId);
    this.repo.deleteOccurrence(id);
  }

  snapshot(): LayerEntityRepositorySnapshot<SavedLayer> {
    return this.repo.snapshot();
  }

  restore(snapshot: LayerEntityRepositorySnapshot<SavedLayer>): void {
    this.repo.restore(snapshot);
  }

  restoreEntities(entities: readonly SavedSharedLayerEntity[]): void {
    const snapshot = this.repo.snapshot();
    snapshot.entities = entities.map(entity => ({
      id: entity.id,
      owner: structuredClone(entity.owner),
      value: structuredClone(entity.layer),
      tombstone: entity.tombstone,
      historyRetainCount: entity.tombstone ? 1 : 0,
    }));
    this.repo.restore(snapshot);
  }

  exportedEntities(): SavedSharedLayerEntity[] {
    return this.repo.snapshot().entities.map(entity => ({
      id: entity.id,
      owner: structuredClone(entity.owner),
      layer: structuredClone(entity.value),
      tombstone: entity.tombstone,
    }));
  }

  async rebuildFromDocuments(pages: readonly SavedPage[], bins: readonly SavedBinItem[]): Promise<void> {
    this.reset();
    for (const bin of bins) {
      for (const layer of bin.layers) {
        const address = this.addressFor(layer.id, { kind: 'bin', id: bin.id }, bin.layers);
        this.repo.createOwned(address, entityRecord(layer));
      }
    }
    for (const page of pages) {
      for (const layer of page.layers) {
        const address = this.addressFor(layer.id, { kind: 'page', id: page.id }, page.layers);
        const link = layer.dataLink;
        if (link) {
          const sourceId = scopedAddressKey(link);
          if (this.repo.occurrences.has(sourceId)) {
            this.repo.createLink(address, sourceId);
            if (layer.canvasStructureSource) {
              try { this.repo.linkCanvasStructure(scopedAddressKey(address), scopedAddressKey(layer.canvasStructureSource)); }
              catch { /* Structure follow still hydrates from the bin document. */ }
            }
            continue;
          }
        }
        this.repo.createOwned(address, entityRecord(layer));
      }
    }
    await replaceSharedLayerEntities(this.exportedEntities());
  }

  async persist(): Promise<void> {
    const meta = await loadProjectMeta();
    const bins = await loadBinItems();
    const pages = meta
      ? (await Promise.all(meta.pageOrder.map(loadPage))).filter((page): page is SavedPage => !!page)
      : [];
    await this.rebuildFromDocuments(pages, bins);
  }

  private liveScopePath(layerId: string): string[] {
    const path: string[] = [];
    let layer = this.engine.layerService.byId(layerId);
    while (layer?.scopeId) {
      path.unshift(layer.scopeId);
      layer = this.engine.layerService.byId(layer.scopeId);
    }
    return path;
  }
}
