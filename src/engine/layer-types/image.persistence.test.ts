/// <reference types="node" />
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createImageLayer } from '../layers';
import { restoreLayerFrom, savedLayerFrom, buildLayerSnapshot } from './registry';

function sampleCanvas(width = 8, height = 4): HTMLCanvasElement {
  return {
    width,
    height,
    getContext: () => ({ drawImage() {} }),
    toBlob: (cb: (blob: Blob | null) => void) => cb(new Blob(['png'], { type: 'image/png' })),
  } as unknown as HTMLCanvasElement;
}

describe('image layer persistence', () => {
  const env = { artboard: { w: 100, h: 80 }, withContent: false, keepCanvas: false, onEncoded() {} };
  const frame = { x: 2, y: 3, width: 16, height: 8, rotation: 0.2 };
  const common = {
    name: '画像',
    opacity: 1,
    blend: 'source-over' as const,
    visible: true,
    parentId: null as string | null,
    childIds: [] as string[],
  };

  it('round-trips geometry and snap through snapshot and saved data', async () => {
    const layer = createImageLayer('画像', sampleCanvas(), frame, 'img', false);
    const snapshot = buildLayerSnapshot(layer, env);
    expect(snapshot.state).toMatchObject({ placement: frame, snapEnabled: false });
    const restored = await restoreLayerFrom({ ...snapshot, canvas: sampleCanvas() }, env);
    expect(restored && restored.type === 'image' && restored.state.snapEnabled).toBe(false);
    if (!restored || restored.type !== 'image') return;
    expect(restored.state.placement).toEqual(frame);
    expect((await savedLayerFrom(layer, env)).state).toMatchObject({ snapEnabled: false, placement: frame });
    expect(layer.state.constrainAspect).toBe(true);
  });

  it('round-trips constrainAspect', async () => {
    const off = createImageLayer('画像', sampleCanvas(), frame, 'img', true, false);
    const snapshot = buildLayerSnapshot(off, env);
    expect(snapshot.state).toMatchObject({ constrainAspect: false });
    const restored = await restoreLayerFrom({ ...snapshot, canvas: sampleCanvas() }, env);
    expect(restored && restored.type === 'image' && restored.state.constrainAspect).toBe(false);
  });

  it('restores missing constrainAspect as true', async () => {
    const restored = await restoreLayerFrom({
      id: 'old',
      type: 'image',
      common,
      state: { placement: frame },
      canvas: sampleCanvas(),
    }, { artboard: { w: 100, h: 80 } });
    expect(restored && restored.type === 'image' && restored.state.snapEnabled).toBe(true);
    expect(restored && restored.type === 'image' && restored.state.constrainAspect).toBe(true);
  });
});
