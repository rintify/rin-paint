// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { canUseLayerAsMask, maskCandidateRows } from './maskCandidates';
import type { LayerMeta } from '../../model';

function layer(
  partial: Pick<LayerMeta, 'id' | 'name' | 'type'> & Partial<LayerMeta>,
): LayerMeta {
  return {
    parentId: null,
    childIds: [],
    opacity: 1,
    blend: 'source-over',
    visible: true,
    version: 0,
    canMergeDown: false,
    canRemove: true,
    canTransferShape: false,
    ...partial,
  };
}

describe('maskCandidateRows', () => {
  const layers: LayerMeta[] = [
    layer({ id: 'folder', name: 'Folder', type: 'raster', childIds: ['a', 'adj', 'outline', 'clip', 'b'] }),
    layer({ id: 'a', name: 'Alpha', type: 'raster', parentId: 'folder' }),
    layer({ id: 'adj', name: 'Adjust', type: 'adjust', parentId: 'folder' }),
    layer({ id: 'outline', name: 'Outline', type: 'outline', parentId: 'folder' }),
    layer({ id: 'clip', name: 'Clip', type: 'clip', parentId: 'folder' }),
    layer({ id: 'b', name: 'Beta', type: 'raster', parentId: 'folder' }),
  ];

  it('allows only earlier outline effects and excludes other effects and the target', () => {
    const rows = maskCandidateRows(['folder'], layers, 'a', '');
    expect(rows.map((r) => r.layer.id)).toEqual(['folder', 'b']);
    expect(canUseLayerAsMask(['folder'], layers, 'clip', 'outline')).toBe(true);
    expect(maskCandidateRows(['folder'], layers, 'clip', '').map(row => row.layer.id))
      .toEqual(['folder', 'a', 'outline', 'b']);
  });

  it('filters by query and keeps ancestor layers', () => {
    const rows = maskCandidateRows(['folder'], layers, 'none', 'bet');
    expect(rows.map((r) => r.layer.id)).toEqual(['folder', 'b']);
  });
});
