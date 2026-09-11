import { describe, expect, it } from 'vitest';
import { packProjectFile, unpackProjectFile, type ProjectFile } from './projectFile';
import { HISTORY_VERSION, PROJECT_MAGIC, PROJECT_VERSION } from './version';
import { isPersistedHistory, isSavedProjectMeta } from './schema';

describe('v5 project container', () => {
  it('stores binary layer/history payloads without base64 and restores them', async () => {
    const history = {
      version: HISTORY_VERSION,
      rootId: 0,
      currentId: 0,
      nodes: [{ id: 0, parentId: null, label: '開始', op: null, childIds: [], lastChild: 0 }],
    };
    const page = {
      id: 'p1',
      canvasSpec: { widthMm: 10, heightMm: 10, ppi: 300 },
      rootLayerIds: ['l1'],
      activeLayerId: 'l1',
      layers: [{
        id: 'l1',
        type: 'raster' as const,
        name: 'L',
        opacity: 1,
        blend: 'source-over' as const,
        visible: true,
        parentId: null,
        childIds: [],
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      }],
      history,
      view: { x: 0, y: 0, scale: 1, rot: 0 },
      thumbnailVersion: 0,
    };
    const meta = {
      version: PROJECT_VERSION,
      pageOrder: ['p1'],
      activePageId: 'p1',
      fonts: [],
      penColor: '#000',
      penSize: 1,
      colorHistory: [],
      tools: [],
      toolLayout: [],
      toolStacks: [],
      activeToolId: null,
    };
    const packed = await packProjectFile({ app: 'rin-paint', version: PROJECT_VERSION, meta, pages: [page] });
    expect(new TextDecoder().decode(await packed.slice(0, PROJECT_MAGIC.length).arrayBuffer())).toBe(PROJECT_MAGIC);
    const restored = await unpackProjectFile(packed) as ProjectFile;
    expect(new Uint8Array(await restored.pages[0].layers[0].blob!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(restored.meta.activeToolId).toBeNull();
  });
});

describe('schema guards', () => {
  it('accepts valid meta and rejects broken history', () => {
    expect(isSavedProjectMeta({
      version: PROJECT_VERSION,
      pageOrder: ['p1'],
      activePageId: 'p1',
      fonts: [],
      penColor: '#000',
      penSize: 1,
      colorHistory: [],
      tools: [],
      toolLayout: [],
      toolStacks: [],
      activeToolId: null,
    })).toBe(true);
    expect(isPersistedHistory({ version: 4, rootId: 0, currentId: 0, nodes: [] })).toBe(false);
    expect(isPersistedHistory({
      version: HISTORY_VERSION,
      rootId: 0,
      currentId: 0,
      nodes: [{ id: 0, label: '開始', op: null, parentId: null, childIds: [], lastChild: 0 }],
    })).toBe(true);
  });
});
