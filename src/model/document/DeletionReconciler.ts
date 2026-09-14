import { LinkResolver, type EntityReader } from './LinkResolver';
import { ScopeResolver } from './ScopeResolver';
import { type DocumentKey, type LayerDocument, type LayerEntity, type LayerSourceAddress } from './types';

export interface DeletionRequirement { source: LayerSourceAddress; occurrenceId?: string }
export interface DeletionRecovery {
  document: DocumentKey;
  entityId: string;
  before: LayerEntity;
  after: LayerEntity;
  created: Record<string, LayerEntity>;
  requirements: DeletionRequirement[];
}

/** Freezes disappearing dependencies against the last committed graph before publishing a deletion. */
export function reconcileDeletedSources(previous: EntityReader, documents: LayerDocument[]): DeletionRecovery[] {
  const before = structuredClone(documents);
  const requirements: DeletionRequirement[] = [];
  const docs = new Map(documents.map(document => [JSON.stringify(document.key), document]));
  const current: EntityReader = {get: address => docs.get(JSON.stringify(address.document))?.entities[address.entityId]};
  const snapshotReader: EntityReader = {get: address => previous.get(address) ?? current.get(address)};
  const oldLinks = new LinkResolver(snapshotReader);
  const oldScopes = new ScopeResolver(snapshotReader);
  const scopes = new ScopeResolver(current);
  const missing = (address: LayerSourceAddress | null): boolean => {
    if (!address || current.get(address) || !previous.get(address)) return false;
    requirements.push({source: structuredClone(address)});
    return true;
  };
  const materializeBinding = (entity: LayerEntity): void => {
    const fields = new Set([...Object.keys(entity.binding.localValues), ...entity.binding.linkedFields]);
    const values: LayerEntity['binding']['localValues'] = {};
    for (const field of fields) {
      const value = oldLinks.fieldFrom(entity, field);
      if (value !== undefined) values[field] = structuredClone(value);
    }
    entity.binding = {source: null, linkedFields: [], localValues: values};
  };
  const copyTree = (entity: LayerEntity, owner: DocumentKey, destination: LayerDocument): LayerEntity => {
    const copy = structuredClone(entity);
    copy.id = crypto.randomUUID();
    materializeBinding(copy);
    destination.entities[copy.id] = copy;
    if (copy.type === 'canvas' && entity.type === 'canvas') {
      const children = oldScopes.childrenFrom(entity, owner);
      copy.structure = {source: null, local: {id: crypto.randomUUID(), children: []}, suppressed: [], placements: [], overrides: {}};
      for (const child of children) {
        const nested = copyTree(child.entity, child.owner, destination);
        copy.structure.local.children.push({id: child.id, entityId: nested.id});
      }
    }
    return copy;
  };
  const visited = new Set<LayerEntity>();
  const reconcile = (entity: LayerEntity, owner: LayerDocument): void => {
    if (visited.has(entity)) return;
    visited.add(entity);
    if (missing(entity.binding.source)) materializeBinding(entity);
    if (entity.type !== 'canvas') return;
    const source = entity.structure.source;
    if (source && missing(source)) {
      const children = oldScopes.childrenFrom(entity, owner.key);
      entity.structure = {source: null, local: {id: entity.structure.local.id, children: []}, suppressed: [], placements: [], overrides: {}};
      for (const child of children) {
        const copy = copyTree(child.entity, child.owner, owner);
        entity.structure.local.children.push({id: child.id, entityId: copy.id});
      }
      return;
    }
    if (source && previous.get(source)) {
      // Resolve upstream deletions first, including chains of canvas variants.
      const sourceDocument = docs.get(JSON.stringify(source.document));
      const sourceEntity = current.get(source);
      if (sourceDocument && sourceEntity) reconcile(sourceEntity, sourceDocument);
      const oldChildren = oldScopes.children(source);
      const remaining = new Set(scopes.children(source).map(child => child.id));
      for (const child of oldChildren) {
        if (remaining.has(child.id) || entity.structure.suppressed.includes(child.id)) continue;
        requirements.push({source: structuredClone(source), occurrenceId: child.id});
        const override = entity.structure.overrides[child.id];
        if (!override) continue;
        // An override may contain only a grandchild edit; preserve the complete effective subtree.
        const copy = copyTree(override, owner.key, owner);
        entity.structure.local.children.push({id: child.id, entityId: copy.id});
        delete entity.structure.overrides[child.id];
      }
    }
    for (const override of Object.values(entity.structure.overrides)) reconcile(override, owner);
  };
  for (const document of documents) for (const entity of Object.values(document.entities)) reconcile(entity, document);
  return before.flatMap(document => {
    const afterDocument = docs.get(JSON.stringify(document.key))!;
    return Object.values(document.entities).flatMap(entity => {
      const after = afterDocument.entities[entity.id];
      if (JSON.stringify(entity) === JSON.stringify(after)) return [];
      const created: Record<string, LayerEntity> = {};
      const visit = (layer: LayerEntity): void => {
        if (layer.type !== 'canvas') return;
        for (const child of layer.structure.local.children) {
          if (document.entities[child.entityId]) continue;
          created[child.entityId] = structuredClone(afterDocument.entities[child.entityId]);
          visit(afterDocument.entities[child.entityId]);
        }
      };
      visit(after);
      return [{document: document.key, entityId: entity.id, before: entity, after: structuredClone(after), created,
        requirements: structuredClone(requirements)}];
    });
  });
}

/** Deletion Undo reconnects only consumers whose authored state has not changed since detachment. */
export function restoreDeletedSources(documents: LayerDocument[], recoveries: readonly DeletionRecovery[]): DeletionRecovery[] {
  const docs = new Map(documents.map(document => [JSON.stringify(document.key), document]));
  const reader: EntityReader = {get: address => docs.get(JSON.stringify(address.document))?.entities[address.entityId]};
  const scopes = new ScopeResolver(reader);
  return recoveries.filter(recovery => {
    const ready = recovery.requirements.every(requirement => {
      if (!reader.get(requirement.source)) return false;
      if (!requirement.occurrenceId) return true;
      try { return scopes.children(requirement.source).some(child => child.id === requirement.occurrenceId); }
      catch { return false; }
    });
    if (!ready) return true;
    const document = docs.get(JSON.stringify(recovery.document));
    const entity = document?.entities[recovery.entityId];
    if (document && JSON.stringify(entity) === JSON.stringify(recovery.after)
      && Object.entries(recovery.created).every(([id, value]) => JSON.stringify(document.entities[id]) === JSON.stringify(value))) {
      document.entities[recovery.entityId] = structuredClone(recovery.before);
      for (const id of Object.keys(recovery.created)) delete document.entities[id];
    }
    return false;
  });
}
