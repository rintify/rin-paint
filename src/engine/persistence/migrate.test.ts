import { describe, expect, it } from 'vitest';
import { migrateClipboard, migrateProjectMeta, migrateSavedPage } from './migrate';
import { HISTORY_VERSION, PROJECT_VERSION } from './version';

const line = () => ({ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10, strokeWidth: 5, color: '#123456' });
const rect = () => ({ kind: 'rect', x: 0, y: 0, width: 10, height: 10, strokeWidth: 2, color: '#000', paintMode: 'stroke' });

describe('v9 project load', () => {
  it('accepts a valid v9 page and keeps history version 7', () => {
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
    expect(page.history.version).toBe(7);
    expect(page.layers[0].shape).toMatchObject({ kind: 'line', strokeWidth: 5 });
  });

  it('rejects legacy project meta versions', () => {
    expect(() => migrateProjectMeta({
      version: 7, pageOrder: ['p'], activePageId: 'p', fonts: [], penColor: '#000', penSizeMm: 1.19,
      colorHistory: [], toolLayout: [], toolStacks: [], activeToolId: null, tools: [], timelapseEnabled: true,
    })).toThrow(/対応していない/);
    expect(() => migrateProjectMeta({
      version: 6, pageOrder: ['p'], activePageId: 'p', fonts: [], penColor: '#000', penSizeMm: 1.19,
      colorHistory: [], toolLayout: [], toolStacks: [], activeToolId: null, tools: [],
    })).toThrow(/対応していない/);
    expect(() => migrateProjectMeta({
      version: 5, pageOrder: ['p'], activePageId: 'p', fonts: [], penColor: '#000', penSize: 4,
      colorHistory: [], toolLayout: [], toolStacks: [], activeToolId: null, tools: [],
    })).toThrow(/対応していない/);
  });

  it('keeps project meta independent and normalizes clipboard shapes', () => {
    const meta = migrateProjectMeta({
      version: PROJECT_VERSION, pageOrder: ['p'], activePageId: 'p', fonts: [],
    });
    expect(meta.version).toBe(9);
    const clipboard = migrateClipboard({
      version: 2, sourcePageId: 'p', sourcePageIndex: 0, sourcePpi: 300, rootIds: ['l'],
      layers: [{ id: 'l', type: 'shape', name: '四角形', opacity: 1, blend: 'source-over', visible: true, parentId: null, childIds: [], shape: rect() }],
    });
    expect(clipboard?.layers[0].shape).toMatchObject({ paintMode: 'stroke' });
  });
});
