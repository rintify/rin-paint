import { describe, expect, it } from 'vitest';
import { createTextLayer } from '../layers';
import { newText } from '../text/model';
import { buildLayerSnapshot, restoreLayerFrom, savedLayerFrom } from './registry';

describe('text layer snapEnabled persistence', () => {
  const env = { artboard: { w: 100, h: 80 }, withContent: false, keepCanvas: false, onEncoded() {} };

  it('defaults to on and round-trips an off setting', async () => {
    expect(createTextLayer('文字', newText(1, 2, '#000')).snapEnabled).toBe(true);
    const off = createTextLayer('文字', newText(1, 2, '#000'), 'off', false);
    const snapshot = buildLayerSnapshot(off, env);
    expect(snapshot.snapEnabled).toBe(false);
    const restored = await restoreLayerFrom(snapshot, env);
    expect(restored && restored.type === 'text' && restored.snapEnabled).toBe(false);
    expect((await savedLayerFrom(off, env)).snapEnabled).toBe(false);
  });

  it('restores missing settings as enabled', async () => {
    const source = buildLayerSnapshot(createTextLayer('文字', newText(1, 2, '#000')), env);
    delete source.snapEnabled;
    const restored = await restoreLayerFrom(source, env);
    expect(restored && restored.type === 'text' && restored.snapEnabled).toBe(true);
  });
});
