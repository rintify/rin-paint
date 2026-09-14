import type { LayerRecord } from './definition';
import type { Layer } from '../layers';

/** Placement belongs to a canvas scope, never to an ordinary layer record. */
export function recordLocation(records: readonly LayerRecord[], id: string): {parentId: string | null; index: number} {
  for (const record of records) {
    const index = record.scope?.children.findIndex(child => child.id === id) ?? -1;
    if (index >= 0) return {parentId: record.id, index};
  }
  return {parentId: null, index: 0};
}

/** Validate canvas-owned placement; ownership is derived, never copied onto children. */
export function rebuildScopeOwnership(layers: readonly Layer[]): void {
  const owners = new Set<string>();
  for (const layer of layers) {
    if (layer.type !== 'canvas') continue;
    for (const id of layer.childIds) {
      if (owners.has(id)) throw new Error('レイヤーが複数のスコープに配置されています');
      owners.add(id);
    }
  }
}
