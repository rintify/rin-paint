// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { PaintEngine } from '../PaintEngine';
import { createShapeLayer } from '../layers';
import { useStore } from '../../state/store';

const original = useStore.getState();
afterEach(() => useStore.setState(original, true));

function shape(id: string) {
  return createShapeLayer(id, {
    kind: 'rect',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    color: '#000000',
    strokeWidth: 1,
    paintMode: 'fill-inside',
  }, id);
}

describe('multi-selection deletion', () => {
  it('removes every selected root in one history operation and restores all on undo', async () => {
    const engine = new PaintEngine();
    const first = shape('first');
    const second = shape('second');
    const remaining = shape('remaining');
    engine.layerService.replaceTree(
      [first, second, remaining],
      [first.id, second.id, remaining.id],
      first.id,
    );
    engine.layerService.beginMultiSelect(second.id);

    engine.removeLayer(second.id);

    expect(engine.layerService.layerRootIds()).toEqual(['remaining']);
    expect(engine.history.current.label).toBe('複数レイヤー削除');

    await engine.undo();
    expect(engine.layerService.layerRootIds()).toEqual(['first', 'second', 'remaining']);
  });

  it('does not duplicate a child when both its parent and itself are selected', async () => {
    const engine = new PaintEngine();
    const parent = shape('parent');
    const child = shape('child');
    parent.childIds = [child.id];
    child.parentId = parent.id;
    engine.layerService.replaceTree([parent, child], [parent.id], parent.id);
    engine.layerService.beginMultiSelect(child.id);

    engine.removeLayer(parent.id);
    expect(engine.layerService.layerRootIds()).toEqual([]);

    await engine.undo();
    expect(engine.layerService.layerRootIds()).toEqual(['parent']);
    expect(engine.layerService.layerChildren(parent.id)).toEqual(['child']);
  });
});
