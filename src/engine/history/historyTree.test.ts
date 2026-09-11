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

  it('round-trips compact merge tiles and counts only their blobs', async () => {
    const history = new HistoryTree();
    const before = new Blob([new Uint8Array(11)]);
    const after = new Blob([new Uint8Array(17)]);
    history.push({
      kind: 'layerMerge',
      format: 'tiles-v1',
      targetLayerId: 'raster-1',
      removed: { location: { parentId: 'raster-1', index: 0 }, snapshot: shapeSnapshot },
      tiles: [{ x: 0, y: 0, w: 32, h: 32, before, after }],
      beforeActiveId: 'shape-1',
      afterActiveId: 'raster-1',
    }, '下のレイヤーと統合');

    expect(history.retainedBytes()).toBe(28);
    const saved = await history.serialize(async () => new Blob());
    expect(saved.nodes[1].op).toMatchObject({
      kind: 'layerMerge',
      format: 'tiles-v1',
      targetLayerId: 'raster-1',
      tiles: [{ x: 0, y: 0, w: 32, h: 32 }],
    });
    const restored = new HistoryTree();
    expect(restored.restore(saved)).toBe(true);
    expect(restored.retainedBytes()).toBe(28);
  });

  it('continues to restore snapshot-based merge history', async () => {
    const history = new HistoryTree();
    history.push({
      kind: 'layerMerge',
      before: [{ location: { parentId: 'raster-1', index: 0 }, snapshot: shapeSnapshot }],
      after: [],
      beforeActiveId: 'shape-1',
      afterActiveId: 'raster-1',
    }, '旧形式の統合');
    const saved = await history.serialize(async () => new Blob());
    const restored = new HistoryTree();
    expect(restored.restore(saved)).toBe(true);
    expect(restored.current.op).toMatchObject({ kind: 'layerMerge', beforeActiveId: 'shape-1' });
  });
});
