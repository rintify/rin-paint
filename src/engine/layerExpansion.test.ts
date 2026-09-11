import { describe, expect, it } from 'vitest';
import { selectedLayerRows, type TreeLayerLike } from './layerTree';

const layer = (id: string, parentId: string | null, childIds: string[] = []): TreeLayerLike => ({ id, parentId, childIds, type: 'raster' });
const layers = [layer('a', null, ['b', 'c']), layer('b', 'a', ['d']), layer('c', 'a', ['e']), layer('d', 'b', ['f']), layer('e', 'c'), layer('f', 'd'), layer('z', null, ['zz']), layer('zz', 'z')];
describe('selection-driven expansion', () => {
  it('shows roots, the selection path and direct children, not grandchildren or other branches', () => {
    expect(selectedLayerRows(['a', 'z'], layers, 'b')).toEqual([{ id: 'z', depth: 0 }, { id: 'a', depth: 0 }, { id: 'c', depth: 1 }, { id: 'b', depth: 1 }, { id: 'd', depth: 2 }]);
  });
  it('closes the old branch when another layer is selected', () => {
    expect(selectedLayerRows(['a', 'z'], layers, 'c').map(r => r.id)).toEqual(['z', 'a', 'c', 'e', 'b']);
    expect(selectedLayerRows(['a', 'z'], layers, 'z').map(r => r.id)).toEqual(['z', 'zz', 'a']);
  });
  it('unions all selected ancestor paths and their direct children', () => {
    expect(selectedLayerRows(['a', 'z'], layers, ['d', 'zz']).map(r => r.id)).toEqual(['z', 'zz', 'a', 'c', 'b', 'd', 'f']);
  });
});
