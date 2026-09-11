import { describe, expect, it } from 'vitest';
import { packProjectFile, unpackProjectFile, type ProjectFile } from './projectFile';

describe('v4 project container', () => {
  it('stores binary layer/history payloads without base64 and restores them', async () => {
    const history = { version: 4 as const, rootId: 0, currentId: 0, nodes: [{ id: 0, parentId: null, label: '開始', op: null, childIds: [], lastChild: 0 }] };
    const page = { id: 'p1', canvasSpec: { widthMm: 10, heightMm: 10, ppi: 300 }, rootLayerIds: ['l1'], activeLayerId: 'l1', layers: [{ id: 'l1', type: 'raster' as const, name: 'L', opacity: 1, blend: 'source-over' as const, visible: true, parentId: null, childIds: [], blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) }], history, view: { x: 0, y: 0, scale: 1, rot: 0 }, thumbnailVersion: 0 };
    const meta = { version: 4 as const, pageOrder: ['p1'], activePageId: 'p1', fonts: [], penColor: '#000', penSize: 1, colorHistory: [], tools: [], toolLayout: [], toolStacks: [], activeToolId: null };
    const packed = await packProjectFile({ app: 'rin-paint', version: 4, meta, pages: [page] });
    expect(new TextDecoder().decode(await packed.slice(0, 9).arrayBuffer())).toBe('RINPAINT4');
    const restored = await unpackProjectFile(packed) as ProjectFile;
    expect(new Uint8Array(await restored.pages[0].layers[0].blob!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(restored.meta.activeToolId).toBeNull();
  });
});
