import { describe, expect, it } from 'vitest';
import { packProjectFile, unpackProjectFile, type ProjectFile } from './projectFile';
import { HISTORY_VERSION, PROJECT_MAGIC, PROJECT_VERSION } from './version';
import { isPersistedHistory, isSavedProjectMeta } from './schema';

const rasterLayer = {
  id: 'l1',
  type: 'raster' as const,
  common: {
    name: 'L',
    opacity: 1,
    blend: 'source-over' as const,
    visible: true,
    parentId: null as string | null,
    childIds: [] as string[],
  },
  state: {},
  content: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
};

describe('v10 project container', () => {
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
      layers: [rasterLayer],
      history,
      view: { x: 0, y: 0, scale: 1, rot: 0 },
      thumbnailVersion: 0,
    };
    const meta = {
      version: PROJECT_VERSION,
      pageOrder: ['p1'],
      activePageId: 'p1',
      fonts: [],
    };
    const packed = await packProjectFile({ app: 'rin-paint', version: PROJECT_VERSION, meta, pages: [page] });
    expect(new TextDecoder().decode(await packed.slice(0, PROJECT_MAGIC.length).arrayBuffer())).toBe(PROJECT_MAGIC);
    const restored = await unpackProjectFile(packed) as ProjectFile;
    expect(new Uint8Array(await restored.pages[0].layers[0].content!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(restored.meta.fonts).toEqual([]);
  });

  it('explicitly rejects a legacy v7 magic container', async () => {
    const history = { version: HISTORY_VERSION, rootId: 0, currentId: 0, nodes: [{ id: 0, parentId: null, label: '開始', op: null, childIds: [], lastChild: 0 }] };
    const page = {
      id: 'p1', canvasSpec: { widthMm: 10, heightMm: 10, ppi: 300 }, rootLayerIds: ['l1'], activeLayerId: 'l1',
      layers: [{
        id: 'l1', type: 'shape' as const,
        common: { name: '直線', opacity: 1, blend: 'source-over' as const, visible: true, parentId: null, childIds: [] },
        state: { shape: { kind: 'line' as const, x1: 0, y1: 0, x2: 10, y2: 10, strokeWidth: 5, color: '#000' }, snapEnabled: true },
      }],
      history, view: { x: 0, y: 0, scale: 1, rot: 0 }, thumbnailVersion: 0,
    };
    const meta = { version: PROJECT_VERSION, pageOrder: ['p1'], activePageId: 'p1', fonts: [] };
    const current = new Uint8Array(await (await packProjectFile({ app: 'rin-paint', version: PROJECT_VERSION, meta, pages: [page] })).arrayBuffer());
    current.set(new TextEncoder().encode('RINPAINT7'), 0);
    await expect(unpackProjectFile(new Blob([current]))).rejects.toThrow(/プロジェクトファイルではありません/);
  });
});

describe('schema guards', () => {
  it('accepts valid meta and rejects broken history', () => {
    expect(isSavedProjectMeta({
      version: PROJECT_VERSION,
      pageOrder: ['p1'],
      activePageId: 'p1',
      fonts: [],
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
