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

function setup() {
  const engine = new PaintEngine();
  const layers = ['a', 'b', 'c', 'd', 'e'].map(shape);
  engine.layerService.replaceTree(layers, layers.map(layer => layer.id), 'a');
  engine.syncStore();
  return engine;
}

describe('moving layers together', () => {
  it.each([
    [5, ['a', 'c', 'e', 'b', 'd']],
    [0, ['b', 'd', 'a', 'c', 'e']],
    [3, ['a', 'c', 'b', 'd', 'e']],
  ])('preserves tree order at index %i and undoes/redoes as one operation', async (index, expected) => {
    const engine = setup();
    engine.beginMultiSelect('b');
    const selected = [...useStore.getState().selectedLayerIds];
    const before = engine.history.current;
    expect(engine.moveLayers(['d', 'b'], { parentId: null, index })).toBe(true);
    expect(engine.layerRootIds()).toEqual(expected);
    expect(useStore.getState().selectedLayerIds).toEqual(selected);
    await engine.undo();
    expect(engine.history.current).toBe(before);
    expect(engine.layerRootIds()).toEqual(['a', 'b', 'c', 'd', 'e']);
    await engine.redo();
    expect(engine.layerRootIds()).toEqual(expected);
  });

  it('keeps selected descendants attached and moves roots from different parents', async () => {
    const engine = setup();
    engine.moveLayer('b', { parentId: 'a', index: 0 });
    engine.moveLayer('d', { parentId: 'c', index: 0 });
    expect(engine.moveLayers(['d', 'b', 'a'], { parentId: 'e', index: 0 })).toBe(true);
    expect(engine.layerRootIds()).toEqual(['c', 'e']);
    expect(engine.layerChildren('e')).toEqual(['a', 'd']);
    expect(engine.layerChildren('a')).toEqual(['b']);
    expect(engine.layerChildren('c')).toEqual([]);
    await engine.undo();
    expect(engine.layerRootIds()).toEqual(['a', 'c', 'e']);
    expect(engine.layerChildren('a')).toEqual(['b']);
    expect(engine.layerChildren('c')).toEqual(['d']);
    await engine.redo();
    expect(engine.layerChildren('e')).toEqual(['a', 'd']);
  });

  it('rejects cycles for the whole selection without partial moves', () => {
    const engine = setup();
    engine.moveLayer('b', { parentId: 'a', index: 0 });
    const before = engine.history.current;
    expect(engine.moveLayers(['c', 'a'], { parentId: 'b', index: 0 })).toBe(false);
    expect(engine.layerRootIds()).toEqual(['a', 'c', 'd', 'e']);
    expect(engine.history.current).toBe(before);
  });

  it('does not create history for an unchanged position or invalid selection', () => {
    const engine = setup();
    const before = engine.history.current;
    for (const index of [1, 2, 3]) {
      expect(engine.moveLayers(['c', 'b'], { parentId: null, index })).toBe(false);
    }
    expect(engine.moveLayers(['b', 'missing'], { parentId: null, index: 5 })).toBe(false);
    expect(engine.moveLayers([], { parentId: null, index: 5 })).toBe(false);
    expect(engine.history.current).toBe(before);
    expect(engine.layerRootIds()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
