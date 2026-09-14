import { describe, expect, it } from 'vitest';
import { canReparent, closestRasterOrRoot, flattenRenderOrder, structuralLowerId, validateLayerTree, type TreeLayerLike } from './layerTree';

const layers: TreeLayerLike[] = [
  { id: 'a', type: 'canvas', childIds: ['b', 'c'] },
  { id: 'b', type: 'canvas', childIds: ['d'] },
  { id: 'c', type: 'shape', childIds: [] },
  { id: 'd', type: 'shape', childIds: [] },
  { id: 'e', type: 'raster', childIds: [] },
];

describe('layer tree', () => {
  it('flattens parent before children in bottom-to-top render order', () => {
    expect(flattenRenderOrder(['e', 'a'], layers)).toEqual(['e', 'a', 'b', 'd', 'c']);
  });

  it('rejects self and descendant reparenting', () => {
    expect(canReparent(layers, 'a', 'a')).toBe(false);
    expect(canReparent(layers, 'a', 'd')).toBe(false);
    expect(canReparent(layers, 'd', 'c')).toBe(false);
  });

  it('validates ownership and rejects cycles', () => {
    expect(validateLayerTree(['e', 'a'], layers)).toBe(true);
    expect(validateLayerTree(['a'], [{ id: 'a', type: 'canvas', childIds: ['b'] }, { id: 'b', type: 'shape', childIds: ['a'] }])).toBe(false);
  });

  it('finds the selected canvas or current scope', () => {
    expect(closestRasterOrRoot(layers, 'd')).toBe('b');
    expect(closestRasterOrRoot(layers, 'e')).toBeNull();
  });

  it('uses only a lower sibling and never crosses canvas boundaries', () => {
    expect(structuralLowerId(layers[2], ['e', 'a'], layers)).toBe('b');
    expect(structuralLowerId(layers[1], ['e', 'a'], layers)).toBeNull();
    const onlyChild = { ...layers[2], id: 'x', parentId: 'a' };
    expect(structuralLowerId(onlyChild, ['e', 'a'], [{ ...layers[0], childIds: ['x'] }, onlyChild, layers[4]])).toBeNull();
  });
});
