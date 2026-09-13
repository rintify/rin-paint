// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { canUseLayerAsMask, maskCandidateRows } from './maskCandidates';
import type { LayerMeta } from '../../model';

function layer(
  partial: Pick<LayerMeta, 'id' | 'name' | 'type'> & Partial<LayerMeta>,
): LayerMeta {
  const state = partial.state ?? (
    partial.type === 'adjust' ? { params: { brightness: 100, contrast: 100, hue: 0, saturation: 100 }, maskLayerIds: [] }
    : partial.type === 'outline' ? { outline: { color: '#000000', widthMm: 1, alphaThreshold: .5, cornerStyle: 'round' } }
    : partial.type === 'clip' ? { maskLayerIds: [] }
    : {}
  );
  return {
    scopeId: null,
    scopeLayerIds: [],
    opacity: 1,
    blend: 'source-over',
    visible: true,
    version: 0,
    canMergeDown: false,
    canRemove: true,
    canTransferShape: false,
    ...partial,
    state,
  } as LayerMeta;
}

describe('maskCandidateRows', () => {
  const layers: LayerMeta[] = [
    layer({ id: 'folder', name: 'Canvas', type: 'canvas', scopeLayerIds: ['a', 'adj', 'outline', 'clip', 'b'], state: { hierarchy: [], propagateTransform: true } }),
    layer({ id: 'a', name: 'Alpha', type: 'raster', scopeId: 'folder' }),
    layer({ id: 'adj', name: 'Adjust', type: 'adjust', scopeId: 'folder' }),
    layer({ id: 'outline', name: 'Outline', type: 'outline', scopeId: 'folder' }),
    layer({ id: 'clip', name: 'Clip', type: 'clip', scopeId: 'folder' }),
    layer({ id: 'b', name: 'Beta', type: 'raster', scopeId: 'folder' }),
  ];

  it('allows only lower mask-capable siblings in the same Canvas scope', () => {
    const rows = maskCandidateRows(['folder'], layers, 'b', '');
    expect(rows.map((r) => r.layer.id)).toEqual(['a', 'outline']);
    expect(canUseLayerAsMask(['folder'], layers, 'clip', 'outline')).toBe(true);
    expect(canUseLayerAsMask(['folder'], layers, 'a', 'folder')).toBe(false);
  });

  it('filters by query and keeps ancestor layers', () => {
    const rows = maskCandidateRows(['folder'], layers, 'b', 'alp');
    expect(rows.map((r) => r.layer.id)).toEqual(['a']);
  });
});
