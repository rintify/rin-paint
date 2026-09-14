import { addressKey, type FieldValue, type LayerEntity, type LayerSourceAddress } from './types';

export interface EntityReader { get(address: LayerSourceAddress): LayerEntity | undefined }

/** Resolves at read time: editing a source never writes into any consumer. */
export class LinkResolver {
  constructor(private readonly repository: EntityReader) {}

  field(address: LayerSourceAddress, field: string): FieldValue | undefined {
    const visited = new Set<string>();
    let current: LayerSourceAddress | null = address;
    while (current) {
      const key = addressKey(current);
      if (visited.has(key)) throw new Error('循環参照です');
      visited.add(key);
      const entity = this.repository.get(current);
      if (!entity) throw new Error('参照先が存在しません');
      const binding = entity.binding;
      if (!binding.source || !binding.linkedFields.includes(field)) return binding.localValues[field];
      current = binding.source;
    }
    return undefined;
  }

  fields(address: LayerSourceAddress): string[] {
    const entity = this.repository.get(address);
    if (!entity) throw new Error('参照先が存在しません');
    return [...new Set([...Object.keys(entity.binding.localValues), ...entity.binding.linkedFields])];
  }

  fieldFrom(entity: LayerEntity, field: string): FieldValue | undefined {
    const binding = entity.binding;
    return binding.source && binding.linkedFields.includes(field)
      ? this.field(binding.source, field) : binding.localValues[field];
  }

  materialize(address: LayerSourceAddress): LayerEntity['binding'] {
    return {
      source: null, linkedFields: [],
      localValues: Object.fromEntries(this.fields(address).flatMap(field => {
        const value = this.field(address, field);
        return value === undefined ? [] : [[field, structuredClone(value)]];
      })),
    };
  }

  /** Includes containment edges, so a canvas cannot link to one of its ancestors. */
  assertLink(target: LayerSourceAddress, source: LayerSourceAddress): void {
    if (target.document.kind === 'bin-item' && source.document.kind === 'page') {
      throw new Error('ビンからページは参照できません');
    }
    const targetKey = addressKey(target), done = new Set<string>(), visiting = new Set<string>();
    const visitEntity = (entity: LayerEntity, address: LayerSourceAddress): void => {
      const follow = (source: LayerSourceAddress) => {
        if (address.document.kind === 'bin-item' && source.document.kind === 'page') throw new Error('ビンからページは参照できません');
        visit(source);
      };
      if (entity.binding.source) follow(entity.binding.source);
      if (entity.type === 'canvas') {
        if (entity.structure.source) follow(entity.structure.source);
        for (const child of entity.structure.local.children) follow({document:address.document,entityId:child.entityId});
        for (const override of Object.values(entity.structure.overrides)) visitEntity(override,address);
      }
    };
    const visit = (address: LayerSourceAddress): void => {
      const key = addressKey(address);
      if (key === targetKey || visiting.has(key)) throw new Error('循環参照です');
      if (done.has(key)) return;
      const entity = this.repository.get(address);
      if (!entity) throw new Error('参照先が存在しません');
      visiting.add(key);
      visitEntity(entity,address);
      visiting.delete(key); done.add(key);
    };
    visit(source);
  }
}

export function overrideField(entity: LayerEntity, field: string, value: FieldValue): void {
  entity.binding.linkedFields = entity.binding.linkedFields.filter(id => id !== field);
  entity.binding.localValues[field] = structuredClone(value);
}

export function relinkField(entity: LayerEntity, field: string): void {
  if (!entity.binding.source) throw new Error('リンク元がありません');
  if (!entity.binding.linkedFields.includes(field)) entity.binding.linkedFields.push(field);
  delete entity.binding.localValues[field];
}
