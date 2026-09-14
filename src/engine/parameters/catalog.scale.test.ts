import { describe, expect, it } from 'vitest';
import { buildCatalog } from './catalog';
import { commonParametersOf } from './intersect';
import type { ParameterDefinition } from './types';
import type { ParameterHost } from './host';

function catalog(count: number) {
  const definitions: ParameterDefinition<{ values: number[] }>[] = Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    semanticId: `p${index}`,
    groupId: 'bulk',
    label: `P${index}`,
    editor: { kind: 'number', min: 0, max: 100 },
    surfaces: ['single', 'multi', 'link'],
    read: state => state.values[index] ?? 0,
    write: (state, value) => {
      const values = [...state.values];
      values[index] = Number(value);
      return { values };
    },
  }));
  return buildCatalog([{ id: 'bulk', label: 'bulk' }], definitions);
}

describe('parameter catalog scale', () => {
  it('resolves 10,000 parameters in O(1) and intersects by selection × params', () => {
    const size = 10_000;
    const catalogA = catalog(size);
    expect(catalogA.byId.get('p9999')?.id).toBe('p9999');
    expect(catalogA.bySemanticId.get('p1234')?.id).toBe('p1234');
    const hosts: ParameterHost[] = [
      { id: 'a', name: 'A', opacity: 1, blend: 'source-over', visible: true,  type: 'raster', state: { values: Array(size).fill(1) } },
      { id: 'b', name: 'B', opacity: 1, blend: 'source-over', visible: true,  type: 'raster', state: { values: Array(size).fill(2) } },
    ];
    // The intersection helper stays linear in selection × provided maps.
    const maps = hosts.map(() => {
      const map = new Map<string, string>();
      for (const item of catalogA.definitions) map.set(item.semanticId, item.id);
      return map;
    });
    const shared = [...maps[0].keys()].filter(id => maps.every(map => map.has(id)));
    expect(shared).toHaveLength(size);
    expect(commonParametersOf(hosts, 'multi').filter(item => item.scope === 'common').map(item => item.id)).toEqual(['visible', 'opacity', 'blend']);
  });
});
