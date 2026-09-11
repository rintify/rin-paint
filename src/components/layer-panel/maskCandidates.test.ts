import { describe, expect, it } from 'vitest';
import { maskCandidateRows } from './maskCandidates';
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
    layer({ id: 'folder', name: 'Folder', type: 'raster', childIds: ['a', 'adj', 'b'] }),
    layer({ id: 'a', name: 'Alpha', type: 'raster', parentId: 'folder' }),
    layer({ id: 'adj', name: 'Adjust', type: 'adjust', parentId: 'folder' }),
    layer({ id: 'b', name: 'Beta', type: 'raster', parentId: 'folder' }),
  ];

  it('excludes adjust layers and the excluded id', () => {
    const rows = maskCandidateRows(['folder'], layers, 'a', '');
    expect(rows.map((r) => r.layer.id)).toEqual(['folder', 'b']);
  });

  it('filters by query and keeps ancestor layers', () => {
    const rows = maskCandidateRows(['folder'], layers, 'none', 'bet');
    expect(rows.map((r) => r.layer.id)).toEqual(['folder', 'b']);
  });
});
