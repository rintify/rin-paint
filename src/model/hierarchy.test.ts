import { describe, expect, it } from 'vitest';
import { flattenHierarchy, lowerLayerIds, normalizeHierarchy, stackDisplayName, stackItem } from './hierarchy';

describe('HierarchyItem', () => {
  it('keeps stack membership transparent to render order', () => {
    const stack = stackItem(['b', 'c'], 'stack-a');
    const items = [{ kind: 'layer' as const, id: 'node-a', layerId: 'a' }, stack];
    expect(flattenHierarchy(items)).toEqual(['a', 'b', 'c']);
    expect(lowerLayerIds(items, 'c')).toEqual(['a', 'b']);
    expect(stackDisplayName(stack, id => id.toUpperCase())).toBe('B・C');
  });

  it('dissolves a stack below two unique members', () => {
    expect(normalizeHierarchy([
      { kind: 'layer', id: 'n1', layerId: 'a' },
      { kind: 'stack', id: 's1', layerIds: ['a', 'b'] },
    ])).toEqual([
      { kind: 'layer', id: 'n1', layerId: 'a' },
      expect.objectContaining({ kind: 'layer', layerId: 'b' }),
    ]);
  });
});

