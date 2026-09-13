import { describe, expect, it } from 'vitest';
import { createShapeLayer } from '../layers';
import { restoreLayerFrom, savedLayerFrom, buildLayerSnapshot } from './registry';

const line = { kind: 'line' as const, x1: 1, y1: 2, x2: 8, y2: 9, color: '#123456', strokeWidth: 3 };
const common = {
  name: '直線',
  opacity: 1,
  blend: 'source-over' as const,
  visible: true,
  scopeId: null as string | null,
  scopeLayerIds: [] as string[],
};
const env = { pageFrame: { w: 100, h: 80 }, withContent: false, keepCanvas: false, onEncoded() {} };

describe('shape layer snapEnabled persistence', () => {
  it('defaults new shapes to snapEnabled true', () => {
    expect(createShapeLayer('直線', line).state.snapEnabled).toBe(true);
    expect(createShapeLayer('直線', line, 'id', false).state.snapEnabled).toBe(false);
  });

  it('round-trips snapEnabled through snapshot and saved data', async () => {
    const on = createShapeLayer('直線', line);
    const off = createShapeLayer('直線', line, 'off', false);
    const snapOn = buildLayerSnapshot(on, env);
    const snapOff = buildLayerSnapshot(off, env);
    expect((snapOn.state as { snapEnabled: boolean }).snapEnabled).toBe(true);
    expect((snapOff.state as { snapEnabled: boolean }).snapEnabled).toBe(false);
    const restoredOn = await restoreLayerFrom(snapOn, env);
    const restoredOff = await restoreLayerFrom(snapOff, env);
    expect(restoredOn && restoredOn.type === 'shape' && restoredOn.state.snapEnabled).toBe(true);
    expect(restoredOff && restoredOff.type === 'shape' && restoredOff.state.snapEnabled).toBe(false);
    expect((await savedLayerFrom(off, env)).state).toMatchObject({ snapEnabled: false });
  });

  it('restores missing snapEnabled as true', async () => {
    const layer = await restoreLayerFrom({
      id: 'old',
      type: 'shape',
      common,
      state: { shape: line },
    }, { pageFrame: { w: 100, h: 80 } });
    expect(layer && layer.type === 'shape' && layer.state.snapEnabled).toBe(true);
  });
});
