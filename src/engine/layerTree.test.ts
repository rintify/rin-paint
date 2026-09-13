import { describe, expect, it } from 'vitest';
import { activeCanvasScope, canReparent, flattenRenderOrder, structuralLowerId, validateLayerTree, type TreeLayerLike } from './layerTree';

const layers: TreeLayerLike[] = [
  { id: 'a', type: 'canvas', scopeId: null, scopeLayerIds: ['b', 'c'] },
  { id: 'b', type: 'adjust', scopeId: 'a', scopeLayerIds: [] },
  { id: 'c', type: 'canvas', scopeId: 'a', scopeLayerIds: ['d'] },
  { id: 'd', type: 'shape', scopeId: 'c', scopeLayerIds: [] },
  { id: 'e', type: 'raster', scopeId: null, scopeLayerIds: [] },
];

describe('layer tree', () => {
  it('treats a Canvas as one sealed item from the outer render scope', () => {
    expect(flattenRenderOrder(['e', 'a'], layers)).toEqual(['e', 'a']);
  });

  it('rejects self and descendant reparenting', () => {
    expect(canReparent(layers, 'a', 'a')).toBe(false);
    expect(canReparent(layers, 'a', 'd')).toBe(false);
    expect(canReparent(layers, 'd', 'c')).toBe(true);
    expect(canReparent(layers, 'd', 'b')).toBe(false);
  });

  it('validates ownership and rejects cycles', () => {
    expect(validateLayerTree(['e', 'a'], layers)).toBe(true);
    expect(validateLayerTree(['a'], [{ id: 'a', type: 'raster', scopeId: null, scopeLayerIds: ['b'] }, { id: 'b', type: 'shape', scopeId: 'a', scopeLayerIds: [] }])).toBe(false);
    expect(validateLayerTree(['a'], [{ id: 'a', type: 'raster', scopeId: null, scopeLayerIds: ['b'] }, { id: 'b', type: 'shape', scopeId: 'a', scopeLayerIds: ['a'] }])).toBe(false);
  });

  it('places additions in the current Canvas scope or at the root', () => {
    expect(activeCanvasScope(layers, 'd')).toBe('c');
    expect(activeCanvasScope(layers, 'e')).toBeNull();
  });

  it('uses a lower sibling, then the parent, and forbids parents from merging', () => {
    expect(structuralLowerId(layers[2], ['e', 'a'], layers)).toBeNull();
    expect(structuralLowerId(layers[1], ['e', 'a'], layers)).toBe('a');
    const onlyChild = { ...layers[3], id: 'x', scopeId: 'a', scopeLayerIds: [] };
    expect(structuralLowerId(onlyChild, ['e', 'a'], [{ ...layers[0], scopeLayerIds: ['x'] }, onlyChild, layers[4]])).toBe('a');
  });
});
