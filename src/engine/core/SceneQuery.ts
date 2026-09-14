import type { LayerType } from '../../model';
import { canMaskLayerType } from '../layer-types/registry';

export interface ScopedLayer {
  id: string;
  childIds?: string[];
  type: LayerType;
  visible: boolean;
}
export type MaskProblem = 'missing' | 'different-scope' | 'not-below' | 'unsupported';
export interface MaskDiagnostic { sourceId: string; problem: MaskProblem }
export const MASK_PROBLEM_LABELS: Record<MaskProblem, string> = {
  missing: '参照先が削除されています',
  'different-scope': '参照先が別のキャンバス内にあります',
  'not-below': '参照先がこのレイヤー未満にありません',
  unsupported: 'マスクに対応しない種類です',
};

/** A single gate for scene reads. Asset linking deliberately does not use this API. */
export class SceneQuery<L extends ScopedLayer> {
  private readonly byId: Map<string, L>;
  private readonly owners = new Map<string, string>();
  constructor(private readonly roots: readonly string[], layers: readonly L[]) {
    this.byId = new Map(layers.map(layer => [layer.id, layer]));
    for (const layer of layers) if (layer.type === 'canvas') for (const id of layer.childIds ?? []) this.owners.set(id, layer.id);
  }
  scopeOf(id: string): string | null { return this.owners.get(id) ?? null; }
  members(scopeId: string | null): L[] {
    const scope = scopeId === null ? null : this.byId.get(scopeId);
    const ids = scopeId === null ? this.roots : scope?.type === 'canvas' ? scope.childIds ?? [] : [];
    return ids.map(id => this.byId.get(id)).filter((layer): layer is L => !!layer);
  }
  visible(scopeId: string | null): L[] { return this.members(scopeId).filter(layer => layer.visible); }
  maskProblem(targetId: string, sourceId: string): MaskProblem | null {
    const source = this.byId.get(sourceId), target = this.byId.get(targetId);
    if (!source || !target) return 'missing';
    if (this.scopeOf(source.id) !== this.scopeOf(target.id)) return 'different-scope';
    if (!canMaskLayerType(source.type)) return 'unsupported';
    const members = this.members(this.scopeOf(target.id));
    if (members.indexOf(source) < 0 || members.indexOf(source) >= members.indexOf(target)) return 'not-below';
    return null;
  }
  masks(targetId: string, sourceIds: readonly string[]): { valid: string[]; invalid: MaskDiagnostic[] } {
    const valid: string[] = [], invalid: MaskDiagnostic[] = [];
    for (const sourceId of new Set(sourceIds)) {
      const problem = this.maskProblem(targetId, sourceId);
      if (problem) invalid.push({sourceId,problem}); else valid.push(sourceId);
    }
    return { valid, invalid };
  }
}
