import { describe, expect, it } from 'vitest';
import { createClipLayer, createOutlineLayer } from '../layers';
import { buildLayerSnapshot, restoreLayerFrom, savedLayerFrom, scaleStoredLayer } from './registry';

const artboard = { w: 100, h: 80 };

describe('effect layer persistence', () => {
  it('round-trips outline parameters through project and history representations', async () => {
    const layer = createOutlineLayer('縁どり 1', 'outline-1');
    layer.outline = { color: '#123456', widthMm: 3.25, alphaThreshold: .72, cornerStyle: 'sharp' };
    layer.opacity = .4;
    layer.parentId = 'parent';
    const saved = await savedLayerFrom(layer, { artboard });
    expect(saved).toMatchObject({
      type: 'outline', outline: layer.outline, opacity: .4, parentId: 'parent', blend: 'source-over',
    });
    const snapshot = buildLayerSnapshot(layer, {
      artboard, withContent: false, keepCanvas: false, onEncoded() {},
    });
    expect(snapshot.outline).toEqual(layer.outline);
    const restored = await restoreLayerFrom(saved, { artboard });
    expect(restored).toMatchObject(saved);
    await scaleStoredLayer(saved, { artboard, factor: 4 });
    expect(saved.outline?.widthMm).toBe(3.25);
  });

  it('round-trips clip masks and keeps blend only as the common saved field', async () => {
    const layer = createClipLayer('クリップ 1', 'clip-1');
    layer.maskLayerIds = ['mask-a', 'mask-b'];
    layer.opacity = .5;
    const saved = await savedLayerFrom(layer, { artboard });
    expect(saved).toMatchObject({ type: 'clip', maskLayerIds: ['mask-a', 'mask-b'], opacity: .5 });
    const restored = await restoreLayerFrom(saved, { artboard });
    expect(restored).toMatchObject(saved);
  });
});
