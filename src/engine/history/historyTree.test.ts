import { describe, expect, it } from 'vitest';
import { HistoryTree, type LayerSnapshot } from './historyTree';

const shapeSnapshot: LayerSnapshot = {
  id: 'shape-1',
  type: 'shape',
  name: '直線',
  opacity: 1,
  blend: 'source-over',
  visible: true,
  parentId: 'raster-1',
  childIds: [],
  shape: { kind: 'line', x1: 1, y1: 2, x2: 30, y2: 40, color: '#123456', width: 5 },
};

describe('shape history persistence', () => {
  it('round-trips tree locations and shape parameters', async () => {
    const history = new HistoryTree();
    history.push({ kind: 'layerAdd', location: { parentId: 'raster-1', index: 2 }, snapshot: shapeSnapshot }, '図形を追加');
    const saved = await history.serialize(async () => new Blob());
    expect(saved.version).toBe(3);
    const restored = new HistoryTree();
    expect(restored.restore(saved)).toBe(true);
    expect(restored.current.op).toMatchObject({ kind: 'layerAdd', location: { parentId: 'raster-1', index: 2 }, snapshot: { shape: shapeSnapshot.shape } });
  });
});
