import { LinkResolver, type EntityReader } from './LinkResolver';
import { ScopeResolver } from './ScopeResolver';
import { addressKey, type DocumentKey, type LayerDocument, type LayerEntity, type LayerSourceAddress } from './types';

export function documentKey(key: DocumentKey): string { return JSON.stringify([key.kind, key.id]); }

/** Model ownership lives here; sessions and history never become link dependencies. */
export class ProjectRepository implements EntityReader {
  private readonly documents = new Map<string, LayerDocument>();
  readonly links = new LinkResolver(this);
  readonly scopes = new ScopeResolver(this);
  private revision = 0;
  private readonly listeners = new Set<(revision: number) => void>();

  get(address: LayerSourceAddress): LayerEntity | undefined {
    return this.documents.get(documentKey(address.document))?.entities[address.entityId];
  }
  document(key: DocumentKey): LayerDocument | undefined { return this.documents.get(documentKey(key)); }
  snapshot(): LayerDocument[] { return structuredClone([...this.documents.values()]); }
  subscribe(listener: (revision: number) => void): () => void {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }

  /** Publish the complete graph atomically: failed validation never changes live data. */
  replace(documents: readonly LayerDocument[]): void {
    const candidate = new ProjectRepository();
    for (const doc of documents) {
      const key = documentKey(doc.key);
      if (candidate.documents.has(key)) throw new Error('編集対象の識別子が重複しています');
      candidate.documents.set(key, structuredClone(doc));
    }
    candidate.validate();
    this.documents.clear();
    for (const [key, doc] of candidate.documents) this.documents.set(key, doc);
    this.revision++;
    for (const listener of this.listeners) listener(this.revision);
  }

  validate(): void {
    for (const doc of this.documents.values()) {
      const occurrenceIds = new Set<string>();
      const validateEntity = (entity: LayerEntity, address: LayerSourceAddress): void => {
        const binding = entity.binding;
        if (new Set(binding.linkedFields).size !== binding.linkedFields.length) throw new Error('参照項目が重複しています');
        if (!binding.source && binding.linkedFields.length) throw new Error('参照元のない参照項目です');
        if (binding.source) this.links.assertLink(address, binding.source);
        if (entity.type !== 'canvas') return;
        const source = entity.structure.source;
        if (source) {
          if (this.get(source)?.type !== 'canvas') throw new Error('構造の参照元はキャンバスに限定されます');
          this.links.assertLink(address, source);
        }
        this.scopes.children(address);
        for (const override of Object.values(entity.structure.overrides)) {
          if (override.binding.source) this.links.assertLink(address, override.binding.source);
        }
      };
      const visited = new Set<string>(), path = new Set<string>();
      const walk = (children: LayerDocument['root']['children']): void => {
        for (const occurrence of children) {
          if (occurrenceIds.has(occurrence.id)) throw new Error('配置の識別子が重複しています');
          occurrenceIds.add(occurrence.id);
          const entity = doc.entities[occurrence.entityId];
          if (!entity) throw new Error('配置された実体が存在しません');
          if (path.has(entity.id)) throw new Error('キャンバスの包含が循環しています');
          if (visited.has(entity.id)) throw new Error('実体の重複配置には参照側実体を作成してください');
          path.add(entity.id); visited.add(entity.id);
          if (entity.type === 'canvas') walk(entity.structure.local.children);
          path.delete(entity.id);
        }
      };
      walk(doc.root.children);
      for (const [id, entity] of Object.entries(doc.entities)) {
        if (id !== entity.id) throw new Error('実体の識別子が一致しません');
        validateEntity(entity, {document:doc.key, entityId:id});
      }
    }
  }

  /** Bin services receive this reader, which cannot enumerate or access pages. */
  binReader(): EntityReader {
    return {get: address => {
      if (address.document.kind !== 'bin-item') throw new Error('ビンからページは参照できません');
      return this.get(address);
    }};
  }

  directConsumers(source: LayerSourceAddress): LayerSourceAddress[] {
    const key = addressKey(source);
    return [...this.documents.values()].flatMap(doc => Object.values(doc.entities).flatMap(entity => {
      const linked = entity.binding.source && addressKey(entity.binding.source) === key;
      const structure = entity.type === 'canvas' && entity.structure.source && addressKey(entity.structure.source) === key;
      return linked || structure ? [{document:doc.key, entityId:entity.id}] : [];
    }));
  }
}
