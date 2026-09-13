import { canLinkDocuments, type DocumentAddress, type ScopedLayerAddress } from '../../model/document';

export interface LayerEntity<T> {
  id: string;
  owner: DocumentAddress;
  value: T;
  tombstone: boolean;
  historyRetainCount: number;
}

export interface LayerOccurrence {
  id: string;
  address: ScopedLayerAddress;
  entityId: string;
  /** Present only for a linked occurrence. Chains are resolved to a final entity. */
  sourceOccurrenceId?: string;
}

export interface CanvasStructureLink {
  occurrenceId: string;
  sourceOccurrenceId: string;
  /** Child keys whose data occurrence has been materialized by copy-on-write. */
  childOverrides: Record<string, string>;
}

export interface LayerEntityRepositorySnapshot<T> {
  entities: LayerEntity<T>[];
  occurrences: LayerOccurrence[];
  canvasStructures: CanvasStructureLink[];
}

/** Shared layer data with direct links, cycle rejection, COW, and tombstones. */
export class LayerEntityRepository<T> {
  readonly entities = new Map<string, LayerEntity<T>>();
  readonly occurrences = new Map<string, LayerOccurrence>();
  readonly canvasStructures = new Map<string, CanvasStructureLink>();

  constructor(private clone: (value: T) => T = structuredClone) {}

  createOwned(address: ScopedLayerAddress, value: T, entityId: string = crypto.randomUUID()): LayerOccurrence {
    if (this.occurrences.has(address.nodeId)) throw new Error('配置ノードIDが重複しています');
    this.entities.set(entityId, {
      id: entityId, owner: { ...address.document }, value: this.clone(value), tombstone: false, historyRetainCount: 0,
    });
    const occurrence = { id: address.nodeId, address: structuredClone(address), entityId };
    this.occurrences.set(occurrence.id, occurrence);
    return occurrence;
  }

  createLink(address: ScopedLayerAddress, sourceOccurrenceId: string): LayerOccurrence {
    const source = this.requireOccurrence(sourceOccurrenceId);
    if (!canLinkDocuments(address.document, source.address.document)) {
      throw new Error('ビン内のレイヤーはページをリンク元にできません');
    }
    if (address.nodeId === sourceOccurrenceId || this.wouldCycle(address.nodeId, sourceOccurrenceId)) {
      throw new Error('リンクが循環します');
    }
    const final = this.resolve(sourceOccurrenceId);
    const occurrence = {
      id: address.nodeId,
      address: structuredClone(address),
      entityId: final.entityId,
      sourceOccurrenceId,
    };
    this.occurrences.set(occurrence.id, occurrence);
    return occurrence;
  }

  resolve(occurrenceId: string): LayerOccurrence {
    let current = this.requireOccurrence(occurrenceId);
    const visited = new Set<string>();
    while (current.sourceOccurrenceId) {
      if (visited.has(current.id)) throw new Error('リンク循環を検出しました');
      visited.add(current.id);
      current = this.requireOccurrence(current.sourceOccurrenceId);
    }
    return current;
  }

  value(occurrenceId: string): T {
    const occurrence = this.resolve(occurrenceId);
    const entity = this.entities.get(occurrence.entityId);
    if (!entity) throw new Error('レイヤー実体が見つかりません');
    return entity.value;
  }

  /** Editing a target materializes only that occurrence; placement edits do not call this. */
  edit(occurrenceId: string, update: (draft: T) => void): LayerOccurrence {
    const occurrence = this.requireOccurrence(occurrenceId);
    if (occurrence.sourceOccurrenceId) {
      const sourceValue = this.value(occurrenceId);
      const entityId = crypto.randomUUID();
      this.entities.set(entityId, {
        id: entityId,
        owner: { ...occurrence.address.document },
        value: this.clone(sourceValue),
        tombstone: false,
        historyRetainCount: 0,
      });
      occurrence.entityId = entityId;
      delete occurrence.sourceOccurrenceId;
    }
    const entity = this.entities.get(occurrence.entityId);
    if (!entity) throw new Error('レイヤー実体が見つかりません');
    update(entity.value);
    return occurrence;
  }

  linkCanvasStructure(occurrenceId: string, sourceOccurrenceId: string): void {
    const target = this.requireOccurrence(occurrenceId), source = this.requireOccurrence(sourceOccurrenceId);
    if (!canLinkDocuments(target.address.document, source.address.document)) throw new Error('ビンからページ方向にだけリンクできます');
    if (this.wouldCycle(occurrenceId, sourceOccurrenceId)) throw new Error('キャンバス構造リンクが循環します');
    this.canvasStructures.set(occurrenceId, { occurrenceId, sourceOccurrenceId, childOverrides: {} });
  }

  resolveCanvasStructure(occurrenceId: string): string {
    let current = occurrenceId;
    const visited = new Set<string>();
    while (this.canvasStructures.has(current)) {
      if (visited.has(current)) throw new Error('キャンバス構造リンクが循環しています');
      visited.add(current);
      current = this.canvasStructures.get(current)!.sourceOccurrenceId;
    }
    return current;
  }

  setCanvasChildOverride(canvasOccurrenceId: string, childKey: string, occurrenceId: string): void {
    const structure = this.canvasStructures.get(canvasOccurrenceId);
    if (!structure) throw new Error('リンクされたキャンバスではありません');
    structure.childOverrides[childKey] = occurrenceId;
  }

  retainForHistory(entityId: string): void {
    const entity = this.entities.get(entityId);
    if (entity) entity.historyRetainCount++;
  }

  releaseFromHistory(entityId: string): void {
    const entity = this.entities.get(entityId);
    if (!entity) return;
    entity.historyRetainCount = Math.max(0, entity.historyRetainCount - 1);
    if (entity.tombstone && entity.historyRetainCount === 0) this.entities.delete(entityId);
  }

  /** Deleting a source freezes every direct/indirect target at its current value. */
  deleteOccurrence(occurrenceId: string): void {
    const occurrence = this.requireOccurrence(occurrenceId);
    const targets = [...this.occurrences.values()].filter(candidate => {
      if (candidate.id === occurrenceId || !candidate.sourceOccurrenceId) return false;
      try { return this.resolve(candidate.id).id === occurrenceId; } catch { return false; }
    });
    for (const target of targets) {
      const entityId = crypto.randomUUID();
      this.entities.set(entityId, {
        id: entityId, owner: { ...target.address.document }, value: this.clone(this.value(target.id)),
        tombstone: false, historyRetainCount: 0,
      });
      target.entityId = entityId;
      delete target.sourceOccurrenceId;
    }
    this.occurrences.delete(occurrenceId);
    this.canvasStructures.delete(occurrenceId);
    const entity = this.entities.get(occurrence.entityId);
    if (!entity) return;
    const stillUsed = [...this.occurrences.values()].some(item => item.entityId === entity.id);
    if (!stillUsed && entity.historyRetainCount > 0) entity.tombstone = true;
    else if (!stillUsed) this.entities.delete(entity.id);
  }

  private requireOccurrence(id: string): LayerOccurrence {
    const occurrence = this.occurrences.get(id);
    if (!occurrence) throw new Error(`配置ノードが見つかりません: ${id}`);
    return occurrence;
  }

  private wouldCycle(targetId: string, sourceId: string): boolean {
    let current: string | undefined = sourceId;
    const visited = new Set<string>();
    while (current) {
      if (current === targetId || visited.has(current)) return true;
      visited.add(current);
      current = this.occurrences.get(current)?.sourceOccurrenceId;
    }
    return false;
  }

  snapshot(): LayerEntityRepositorySnapshot<T> {
    return {
      entities: structuredClone([...this.entities.values()]),
      occurrences: structuredClone([...this.occurrences.values()]),
      canvasStructures: structuredClone([...this.canvasStructures.values()]),
    };
  }

  restore(snapshot: LayerEntityRepositorySnapshot<T>): void {
    this.entities.clear(); this.occurrences.clear(); this.canvasStructures.clear();
    for (const entity of snapshot.entities) this.entities.set(entity.id, structuredClone(entity));
    for (const occurrence of snapshot.occurrences) this.occurrences.set(occurrence.id, structuredClone(occurrence));
    for (const structure of snapshot.canvasStructures) this.canvasStructures.set(structure.occurrenceId, structuredClone(structure));
    for (const occurrence of this.occurrences.values()) this.resolve(occurrence.id);
  }
}
