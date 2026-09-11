import { describe, expect, it } from 'vitest';
import { migrateClipboard, migrateProjectMeta, migrateSavedPage } from './migrate';
import { HISTORY_VERSION, PROJECT_VERSION } from './version';

const line = () => ({ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10, strokeWidth: 5, color: '#123456' });
const rect = () => ({ kind: 'rect', x: 0, y: 0, width: 10, height: 10, strokeWidth: 2, color: '#000', paintMode: 'stroke' });

describe('v7 project load', () => {
  it('accepts a valid v7 page and keeps history version 6', () => {
    const page = migrateSavedPage({
      id: 'p', canvasSpec: { widthMm: 10, heightMm: 10, ppi: 300 }, rootLayerIds: ['l'], activeLayerId: 'l',
      layers: [{ id: 'l', type: 'shape', name: '直線', opacity: 1, blend: 'source-over', visible: true, parentId: null, childIds: [], shape: line() }],
      history: {
        version: HISTORY_VERSION, rootId: 0, currentId: 0,
        nodes: [
          { id: 0, label: '開始', op: null, parentId: null, childIds: [], lastChild: 0 },
        ],
      },
      view: { x: 0, y: 0, scale: 1, rot: 0 }, thumbnailVersion: 0,
    });
    expect(page.history.version).toBe(6);
    expect(page.layers[0].shape).toMatchObject({ kind: 'line', strokeWidth: 5 });
  });

  it('rejects legacy project meta versions', () => {
    expect(() => migrateProjectMeta({
      version: 6, pageOrder: ['p'], activePageId: 'p', fonts: [], penColor: '#000', penSizeMm: 1.19,
      colorHistory: [], toolLayout: [], toolStacks: [], activeToolId: null, tools: [],
    })).toThrow(/対応していない/);
    expect(() => migrateProjectMeta({
      version: 5, pageOrder: ['p'], activePageId: 'p', fonts: [], penColor: '#000', penSize: 4,
      colorHistory: [], toolLayout: [], toolStacks: [], activeToolId: null, tools: [],
    })).toThrow(/対応していない/);
  });

  it('normalizes v7 tools and clipboard shapes', () => {
    const meta = migrateProjectMeta({
      version: PROJECT_VERSION, pageOrder: ['p'], activePageId: 'p', fonts: [], penColor: '#000', penSizeMm: 1.19,
      colorHistory: [], toolLayout: [{ type: 'tool', toolId: 'r' }], toolStacks: [], activeToolId: 'r',
      tools: [{ id: 'r', kind: 'rect', name: '四角', sizeMm: 1.19, color: '#000' }],
    });
    expect(meta.version).toBe(7);
    expect((meta.tools[0].settings as { paintMode?: string })?.paintMode).toBe('stroke');
    const clipboard = migrateClipboard({
      version: 1, sourcePageId: 'p', sourcePpi: 300, rootIds: ['l'],
      layers: [{ id: 'l', type: 'shape', name: '四角形', opacity: 1, blend: 'source-over', visible: true, parentId: null, childIds: [], shape: rect() }],
    });
    expect(clipboard?.layers[0].shape).toMatchObject({ paintMode: 'stroke' });
  });
});
