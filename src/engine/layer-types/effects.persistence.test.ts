/// <reference types="node" />
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createClipLayer, createOutlineLayer, createAdjustLayer } from '../layers';
import { buildLayerSnapshot, restoreLayerFrom, savedLayerFrom } from './registry';
import { DEFAULT_ADJUST, DEFAULT_OUTLINE } from '../../model';

const artboard = { w: 100, h: 80 };
const env = { artboard, withContent: false };

describe('effect layer persistence', () => {
  it('round-trips outline parameters through project and history representations', async () => {
    const layer = createOutlineLayer('縁どり 1', 'outline-1');
    layer.state.outline = { color: '#123456', widthMm: 3.25, alphaThreshold: .72, cornerStyle: 'sharp' };
    layer.opacity = .4;
    const saved = await savedLayerFrom(layer, { artboard });
    expect(saved.common).not.toHaveProperty('parentId');
    expect(saved.common).not.toHaveProperty('childIds');
    expect(saved).toMatchObject({
      type: 'outline',
      common: { opacity: .4, blend: 'source-over' },
      state: { outline: layer.state.outline },
    });
    const snapshot = buildLayerSnapshot(layer, env);
    expect(snapshot.state).toEqual(layer.state);
    const restored = await restoreLayerFrom(saved, { artboard });
    expect(restored?.state).toEqual(saved.state);
    expect(restored?.opacity).toBe(.4);
    const higherPpi = await restoreLayerFrom(saved, { artboard, ppi: 1200 });
    expect(higherPpi?.state).toEqual(saved.state);
    expect((saved.state as { outline: { widthMm: number } }).outline.widthMm).toBe(3.25);
  });

  it('round-trips clip masks and keeps blend only as the common saved field', async () => {
    const layer = createClipLayer('クリップ 1', 'clip-1');
    layer.state.maskLayerIds = ['mask-a', 'mask-b'];
    layer.opacity = .5;
    const saved = await savedLayerFrom(layer, { artboard });
    expect(saved.common).not.toHaveProperty('parentId');
    expect(saved.common).not.toHaveProperty('childIds');
    expect(saved).toMatchObject({
      type: 'clip',
      common: { opacity: .5 },
      state: { maskLayerIds: ['mask-a', 'mask-b'] },
    });
    const restored = await restoreLayerFrom(saved, { artboard });
    expect(restored?.type).toBe('clip');
    expect(restored && restored.type === 'clip' && restored.state.maskLayerIds).toEqual(['mask-a', 'mask-b']);
  });

  it('round-trips raster, adjust, and empty clip/outline defaults', async () => {
    const adjust = createAdjustLayer('補正', 'a1');
    adjust.state.params = { ...DEFAULT_ADJUST, brightness: 40 };
    const outline = createOutlineLayer('縁', 'o1');
    expect(outline.state.outline).toMatchObject(DEFAULT_OUTLINE);
    for (const layer of [adjust, outline]) {
      const saved = await savedLayerFrom(layer, { artboard });
    expect(saved.common).not.toHaveProperty('parentId');
    expect(saved.common).not.toHaveProperty('childIds');
      const restored = await restoreLayerFrom(saved, { artboard });
      expect(restored?.type).toBe(layer.type);
      expect(restored?.state).toEqual(layer.state);
    }
  });
});
