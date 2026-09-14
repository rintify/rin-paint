import { describe, expect, it } from 'vitest';
import { HistoryTree, type LayerSnapshot } from './historyTree';
import { HISTORY_VERSION } from '../persistence/version';

const shapeSnapshot: LayerSnapshot = {
  id: 'shape-1',
  type: 'shape',
  common: {
    name: '直線',
    opacity: 1,
    blend: 'source-over',
    visible: true,
    parentId: 'raster-1',
    childIds: [],
  },
  state: { shape: { kind: 'line', x1: 1, y1: 2, x2: 30, y2: 40, color: '#123456', strokeWidth: 5 }, snapEnabled: true },
};

describe('shape history persistence', () => {
  it('round-trips tree locations and shape parameters', async () => {
    const history = new HistoryTree();
    history.push({ kind: 'layerAdd', location: { parentId: 'raster-1', index: 2 }, snapshot: shapeSnapshot }, '図形を追加');
    const saved = await history.serialize(async () => new Blob());
    expect(saved.version).toBe(HISTORY_VERSION);
    const restored = new HistoryTree();
    expect(restored.restore(saved)).toBe(true);
    expect(restored.current.op).toMatchObject({
      kind: 'layerAdd',
      location: { parentId: 'raster-1', index: 2 },
      snapshot: { state: shapeSnapshot.state },
    });
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

  it('rejects legacy snapshot-based merge history', async () => {
    const restored = new HistoryTree();
    expect(restored.restore({
      version: HISTORY_VERSION,
      rootId: 0,
      currentId: 1,
      nodes: [
        { id: 0, label: '開始', op: null, parentId: null, childIds: [1], lastChild: 0 },
        {
          id: 1,
          label: '旧形式',
          op: {
            kind: 'layerMerge',
            before: [{ location: { parentId: null, index: 0 }, snapshot: shapeSnapshot }],
            after: [],
            beforeActiveId: 'a',
            afterActiveId: 'b',
          },
          parentId: 0,
          childIds: [],
          lastChild: 0,
        },
      ],
    })).toBe(true);
    expect(restored.current.op?.kind).toBe('layerMerge');
  });

  it('round-trips a batch as one history node', async () => {
    const history = new HistoryTree();
    history.push({ kind: 'batch', ops: [
      { kind: 'layerProps', layerId: 'a', before: { opacity: 1 }, after: { opacity: .5 } },
      { kind: 'layerProps', layerId: 'b', before: { visible: true }, after: { visible: false } },
    ] }, '複数レイヤー設定');
    const restored = new HistoryTree();
    expect(restored.restore(await history.serialize(async () => new Blob()))).toBe(true);
    expect(restored.current.op).toMatchObject({ kind: 'batch', ops: [{ layerId: 'a' }, { layerId: 'b' }] });
  });

  it('round-trips cross-page layer link operations', async () => {
    const history = new HistoryTree();
    const link = {
      source: { pageId: 'source-page', layerId: 'source-layer' },
      sourceNameHint: '元',
      sourcePageIndexHint: 0,
      linkedParameterIds: ['layer.opacity'],
      fallbackValues: { 'layer.opacity': 75 },
    };
    history.push({
      kind: 'layerLink',
      target: { pageId: 'target-page', layerId: 'target-layer' },
      before: null,
      after: link,
    }, 'リンク元を変更');
    const restored = new HistoryTree();
    expect(restored.restore(await history.serialize(async () => new Blob()))).toBe(true);
    expect(restored.current.op).toEqual(expect.objectContaining({ kind: 'layerLink', after: link }));
  });
});
