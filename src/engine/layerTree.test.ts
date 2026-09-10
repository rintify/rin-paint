import { describe, expect, it } from 'vitest';
import { canReparent, closestRasterOrRoot, flattenRenderOrder, structuralLowerId, validateLayerTree, type TreeLayerLike } from './layerTree';

const layers: TreeLayerLike[] = [
  { id: 'a', type: 'raster', parentId: null, childIds: ['b', 'c'] },
  { id: 'b', type: 'adjust', parentId: 'a', childIds: ['d'] },
  { id: 'c', type: 'shape', parentId: 'a', childIds: [] },
  { id: 'd', type: 'shape', parentId: 'b', childIds: [] },
  { id: 'e', type: 'raster', parentId: null, childIds: [] },
];

describe('layer tree', () => {
  it('flattens parent before children in bottom-to-top render order', () => {
    expect(flattenRenderOrder(['e', 'a'], layers)).toEqual(['e', 'a', 'b', 'd', 'c']);
  });

  it('rejects self and descendant reparenting', () => {
    expect(canReparent(layers, 'a', 'a')).toBe(false);
    expect(canReparent(layers, 'a', 'd')).toBe(false);
    expect(canReparent(layers, 'd', 'c')).toBe(true);
  });

  it('validates ownership and rejects cycles', () => {
    expect(validateLayerTree(['e', 'a'], layers)).toBe(true);
    expect(validateLayerTree(['a'], [{ id: 'a', type: 'raster', parentId: null, childIds: ['b'] }, { id: 'b', type: 'shape', parentId: 'a', childIds: ['a'] }])).toBe(false);
  });

  it('finds the nearest raster ancestor or root placement', () => {
    expect(closestRasterOrRoot(layers, 'd')).toBe('a');
    expect(closestRasterOrRoot(layers, 'e')).toBe('e');
  });

  it('uses a lower sibling, then the parent, and forbids parents from merging', () => {
    expect(structuralLowerId(layers[2], ['e', 'a'], layers)).toBe('b');
    expect(structuralLowerId(layers[1], ['e', 'a'], layers)).toBeNull();
    const onlyChild = { ...layers[2], id: 'x', parentId: 'a' };
    expect(structuralLowerId(onlyChild, ['e', 'a'], [{ ...layers[0], childIds: ['x'] }, onlyChild, layers[4]])).toBe('a');
  });
});
