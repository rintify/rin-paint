import { describe, expect, it } from 'vitest';
import { migrateClipboard, migrateProjectMeta, migrateSavedPage } from './migrate';

const line = () => ({ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10, width: 5, color: '#123456' });
const rect = () => ({ kind: 'rect', x: 0, y: 0, width: 10, height: 10, strokeWidth: 2, color: '#000' });

describe('v5 to v6 migration', () => {
  it('normalizes pages and every history branch recursively', () => {
    const page = migrateSavedPage({
      id: 'p', canvasSpec: { widthMm: 10, heightMm: 10, ppi: 300 }, rootLayerIds: ['l'], activeLayerId: 'l',
      layers: [{ id: 'l', type: 'shape', name: '直線', opacity: 1, blend: 'source-over', visible: true, parentId: null, childIds: [], shape: line() }],
      history: {
        version: 5, rootId: 0, currentId: 1,
        nodes: [
          { id: 0, label: '開始', op: null, parentId: null, childIds: [1, 2], lastChild: 0 },
          { id: 1, label: 'A', op: { kind: 'layerProps', layerId: 'l', before: { shape: line() }, after: { shape: rect() } }, parentId: 0, childIds: [], lastChild: 0 },
          { id: 2, label: 'B', op: { kind: 'layerProps', layerId: 'l', before: { shape: rect() }, after: { shape: line() } }, parentId: 0, childIds: [], lastChild: 0 },
        ],
      },
      view: { x: 0, y: 0, scale: 1, rot: 0 }, thumbnailVersion: 0,
    });
    expect(page.history.version).toBe(6);
    expect(page.layers[0].shape).toMatchObject({ kind: 'line', strokeWidth: 5 });
    expect(page.layers[0].shape).not.toHaveProperty('width');
    const branches = page.history.nodes.slice(1).map(node => JSON.stringify(node.op));
    expect(branches.every(value => !value.includes('"width":5'))).toBe(true);
    expect(branches.every(value => value.includes('"paintMode":"stroke"'))).toBe(true);
  });

  it('adds default tool settings and normalizes clipboard shapes', () => {
    const meta = migrateProjectMeta({
      version: 5, pageOrder: ['p'], activePageId: 'p', fonts: [], penColor: '#000', penSize: 4,
      colorHistory: [], toolLayout: [{ type: 'tool', toolId: 'r' }], toolStacks: [], activeToolId: 'r',
      tools: [{ id: 'r', kind: 'rect', name: '四角', size: 4, color: '#000' }],
    });
    expect(meta.version).toBe(6);
    expect((meta.tools[0].settings as { paintMode?: string })?.paintMode).toBe('stroke');
    const clipboard = migrateClipboard({
      version: 1, sourcePageId: 'p', sourcePpi: 300, rootIds: ['l'],
      layers: [{ id: 'l', type: 'shape', name: '四角形', opacity: 1, blend: 'source-over', visible: true, parentId: null, childIds: [], shape: rect() }],
    });
    expect(clipboard?.layers[0].shape).toMatchObject({ paintMode: 'stroke' });
  });
});
