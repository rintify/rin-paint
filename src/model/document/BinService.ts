import { CommandService } from './CommandService';
import { ProjectRepository } from './ProjectRepository';
import { addressKey, type DocumentKey, type FieldValueMap, type LayerDocument, type LayerEntity, type LayerSourceAddress, type Occurrence } from './types';

const MASK_FIELDS = new Set(['mask.sources']);

/** Registration is durable project state; only page binding changes enter page history. */
export class BinService {
  constructor(private readonly repository: ProjectRepository, private readonly commands: CommandService) {}

  register(source: LayerSourceAddress): LayerSourceAddress {
    if (source.document.kind !== 'page') throw new Error('ページの個別レイヤーを指定してください');
    const entity = this.repository.get(source);
    if (!entity) throw new Error('レイヤーが存在しません');
    const key = {kind:'bin-item' as const,id:crypto.randomUUID()};
    const destination = {document:key,entityId:entity.id};
    const bin: LayerDocument = {key,root:{id:crypto.randomUUID(),children:[{id:crypto.randomUUID(),entityId:entity.id}]},entities:{}};
    const mapping = new Map<string, LayerSourceAddress>();
    const seenOccurrences = new Set<string>();
    const copy = (current: LayerEntity, origin: LayerSourceAddress, owner: DocumentKey): LayerEntity => {
      const id = bin.entities[current.id] ? crypto.randomUUID() : current.id;
      mapping.set(addressKey(origin),{document:key,entityId:id});
      const clone = structuredClone(current);
      clone.id = id;
      bin.entities[id] = clone;
      const fields = [...new Set([...Object.keys(current.binding.localValues),...current.binding.linkedFields])];
      const values: FieldValueMap = {};
      for (const field of fields) {
        const value = this.repository.links.fieldFrom(current,field);
        if (value !== undefined) values[field] = structuredClone(value);
      }
      // The snapshot is taken before stripping page dependencies.
      clone.binding.localValues = values;
      if (clone.type === 'canvas' && current.type === 'canvas') {
        const children = this.repository.scopes.childrenFrom(current,owner);
        clone.structure = {source:null,local:{id:crypto.randomUUID(),children:[]},suppressed:[],placements:[],overrides:{}};
        for (const child of children) {
          seenOccurrences.add(child.id);
          const copied = copy(child.entity,child.origin,child.owner);
          clone.structure.local.children.push({id:child.id,entityId:copied.id});
        }
      }
      return clone;
    };
    const root = copy(entity,source,source.document);
    bin.root.children[0].entityId = root.id;
    for (const current of Object.values(bin.entities)) {
      const binding = current.binding;
      if (binding.source?.document.kind === 'page') {
        const internal = mapping.get(addressKey(binding.source));
        if (internal) binding.source = internal;
        else { binding.source = null; binding.linkedFields = []; }
      }
      for (const field of MASK_FIELDS) {
        const value = binding.localValues[field];
        if (Array.isArray(value)) binding.localValues[field] = value.filter(id => typeof id === 'string' && seenOccurrences.has(id));
        binding.linkedFields = binding.linkedFields.filter(id => id !== field);
      }
      // Retained internal/bin links resolve on read; do not save duplicate copies of their values.
      if (binding.source) for (const field of binding.linkedFields) delete binding.localValues[field];
    }
    // Commit registration first. Page Undo deliberately cannot remove this document.
    this.repository.replace([...this.repository.snapshot(),bin]);
    this.commands.execute(source.document,'ビン素材を参照',draft => {
      const pageEntity = draft.entities[source.entityId];
      const localValues: FieldValueMap = {};
      for (const field of MASK_FIELDS) {
        const value = this.repository.links.fieldFrom(entity,field);
        if (value !== undefined) localValues[field] = structuredClone(value);
      }
      pageEntity.binding = {source:destination,
        linkedFields:this.repository.links.fields(destination).filter(field => !MASK_FIELDS.has(field)),localValues};
      if (pageEntity.type === 'canvas') {
        // Existing occurrence IDs in the bin keep page selection and internal mask IDs stable.
        pageEntity.structure = {source:destination,local:{id:pageEntity.structure.local.id,children:[]},suppressed:[],placements:[],overrides:{}};
      }
    });
    return destination;
  }

  addReference(source: LayerSourceAddress, page: LayerDocument['key'], scopeId: string, index: number): string {
    if (source.document.kind !== 'bin-item' || page.kind !== 'page') throw new Error('ビン素材とページを指定してください');
    const origin = this.repository.get(source);
    if (!origin) throw new Error('ビン素材が存在しません');
    const id = crypto.randomUUID(), occurrence: Occurrence = {id:crypto.randomUUID(),entityId:id};
    this.commands.execute(page,'ビン素材のリンクを追加',draft => {
      const entity = structuredClone(origin); entity.id = id;
      entity.binding = {source,linkedFields:this.repository.links.fields(source),localValues:{}};
      if (entity.type === 'canvas') entity.structure = {source,local:{id:crypto.randomUUID(),children:[]},suppressed:[],placements:[],overrides:{}};
      let scope = draft.root;
      if (scope.id !== scopeId) {
        const canvas = Object.values(draft.entities).find(layer => layer.type === 'canvas' && layer.structure.local.id === scopeId);
        if (canvas?.type !== 'canvas') throw new Error('追加先スコープが存在しません');
        scope = canvas.structure.local;
      }
      draft.entities[id] = entity;
      scope.children.splice(Math.max(0,Math.min(index,scope.children.length)),0,occurrence);
    });
    return occurrence.id;
  }
}
