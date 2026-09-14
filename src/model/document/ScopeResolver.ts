import type { EntityReader } from './LinkResolver';
import { addressKey, type DocumentKey, type LayerEntity, type LayerSourceAddress, type ResolvedOccurrence } from './types';

/** Ordered overlays preserve source sibling order unless explicitly overridden. */
export class ScopeResolver {
  constructor(private readonly repository: EntityReader) {}
  children(address: LayerSourceAddress): ResolvedOccurrence[] {
    return this.resolve(address, new Set());
  }
  childrenOf(child: ResolvedOccurrence): ResolvedOccurrence[] {
    return this.childrenFrom(child.entity, child.owner);
  }
  childrenFrom(entity: LayerEntity, owner: DocumentKey): ResolvedOccurrence[] {
    if (entity.type !== 'canvas') throw new Error('キャンバスではありません');
    return this.resolveEntity(entity, owner, new Set());
  }
  private resolve(address: LayerSourceAddress, visiting: Set<string>): ResolvedOccurrence[] {
    const key = addressKey(address);
    if (visiting.has(key)) throw new Error('循環したキャンバス構造です');
    const canvas = this.repository.get(address);
    if (!canvas || canvas.type !== 'canvas') throw new Error('キャンバスが存在しません');
    visiting.add(key);
    const result = this.resolveEntity(canvas, address.document, visiting);
    visiting.delete(key);
    return result;
  }
  private resolveEntity(canvas: LayerEntity & {type:'canvas'}, owner: DocumentKey, visiting: Set<string>): ResolvedOccurrence[] {
    const structure = canvas.structure;
    const inherited = structure.source ? this.resolve(structure.source, visiting) : [];
    const suppressed = new Set(structure.suppressed);
    const result = inherited.filter(child => !suppressed.has(child.id)).map(child => ({
      ...child, entity: structure.overrides[child.id] ?? child.entity,
      owner: structure.overrides[child.id] ? owner : child.owner,
    }));
    for (const child of structure.local.children) {
      if (result.some(existing => existing.id === child.id)) throw new Error('子の識別子が重複しています');
      const origin = {document:owner, entityId:child.entityId};
      const entity = this.repository.get(origin);
      if (!entity) throw new Error('子の実体が存在しません');
      result.push({id:child.id, entity, origin, owner});
    }
    for (const placement of structure.placements) {
      if (!Number.isSafeInteger(placement.index) || placement.index < 0) throw new Error('不正な配置位置です');
      const index = result.findIndex(child => child.id === placement.occurrenceId);
      if (index < 0) continue;
      const [child] = result.splice(index, 1);
      result.splice(Math.min(placement.index, result.length), 0, child);
    }
    return result;
  }
}
