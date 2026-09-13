// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createImageLayer, createShapeLayer, makeCanvas } from '../layers';
import { restoreLayerFrom, savedLayerFrom } from '../layer-types/registry';

describe('millimetre geometry persistence', () => {
  it('keeps vector geometry at the same physical size across page PPI', async () => {
    const layer = createShapeLayer('shape', {
      kind: 'rect', x: 300, y: 150, width: 600, height: 300,
      color: '#000', strokeWidth: 30, paintMode: 'stroke',
    });
    const saved = await savedLayerFrom(layer, { pageFrame: { w: 1200, h: 900 }, ppi: 300 });
    expect(saved.geometryUnit).toBe('mm');
    expect((saved.state as typeof layer.state).shape).toMatchObject({ x: 25.4, width: 50.8, strokeWidth: 2.54 });
    const restored = await restoreLayerFrom(saved, { pageFrame: { w: 2400, h: 1800 }, ppi: 600 });
    expect(restored?.type).toBe('shape');
    if (restored?.type === 'shape') expect(restored.state.shape).toMatchObject({ x: 600, width: 1200, strokeWidth: 60 });
  });

  it('stores image frames in millimetres without resampling their source pixels', async () => {
    const source = makeCanvas(40, 20);
    const layer = createImageLayer('image', source, { x: 100, y: 200, width: 300, height: 150, rotation: .2 });
    const saved = await savedLayerFrom(layer, { pageFrame: { w: 1000, h: 1000 }, ppi: 254 });
    const placement = (saved.state as typeof layer.state).placement;
    expect(placement.x).toBeCloseTo(10);
    expect(placement.y).toBeCloseTo(20);
    expect(placement.width).toBeCloseTo(30);
    expect(placement.height).toBeCloseTo(15);
  });
});
