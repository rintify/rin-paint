import { describe, expect, it } from 'vitest';
import type { SavedBinItem, SavedLayer } from '../persistence/db';
import { hydrateLinkedRecords, synchronizeCanvasLinkedRecords } from './linkedRecords';

const common = { name: 'source', opacity: 1, blend: 'source-over' as const, visible: true };
const source: SavedLayer = {
  id: 'source-layer', type: 'shape', common,
  state: { shape: { kind: 'rect', x: 1, y: 2, width: 3, height: 4, color: '#000', strokeWidth: 0, paintMode: 'fill-inside' }, snapEnabled: true },
};
const bin: SavedBinItem = {
  id: 'bin-a', name: 'asset', hierarchy: [{ kind: 'layer', id: 'node', layerId: source.id }],
  layers: [source], activeLayerId: source.id,
  history: { version: 9, rootId: 0, currentId: 0, nodes: [{ id: 0, label: '開始', op: null, scopeId: null, scopeLayerIds: [], lastChild: 0 }] },
  ppi: 300, visible: true,
};

describe('hydrateLinkedRecords', () => {
  it('hydrates whole data while keeping the target occurrence identity', () => {
    const target: SavedLayer = {
      id: 'target-layer', type: 'shape', common: { ...common, name: 'stale' }, state: {},
      dataLink: { document: { kind: 'bin', id: bin.id }, scopePath: [], nodeId: source.id },
    };
    const [result] = hydrateLinkedRecords([target], [bin]);
    expect(result.id).toBe('target-layer');
    expect(result.common.name).toBe('source');
    expect(result.state).toEqual(source.state);
    expect(result.dataLink).toEqual(target.dataLink);
  });

  it('materializes a missing source instead of leaving a broken link', () => {
    const target: SavedLayer = {
      id: 'target-layer', type: 'shape', common, state: source.state,
      dataLink: { document: { kind: 'bin', id: 'missing' }, scopePath: [], nodeId: 'none' },
    };
    expect(hydrateLinkedRecords([target], [bin])[0].dataLink).toBeUndefined();
  });

  it('follows Canvas structure per placement while retaining a child COW override', () => {
    const canvas: SavedLayer = {
      id: 'canvas-source', type: 'canvas', common,
      state: { hierarchy: [
        { kind: 'layer', id: 'n1', layerId: 'child-a' },
        { kind: 'layer', id: 'n2', layerId: 'child-b' },
      ], propagateTransform: true },
    };
    const childA = { ...structuredClone(source), id: 'child-a' };
    const childB = { ...structuredClone(source), id: 'child-b', common: { ...common, name: 'new child' } };
    const canvasBin = { ...bin, id: 'canvas-bin', layers: [canvas, childA, childB], hierarchy: [{ kind: 'layer' as const, id: 'root', layerId: canvas.id }] };
    const rootAddress = { document: { kind: 'bin' as const, id: canvasBin.id }, scopePath: [], nodeId: canvas.id };
    const childAddress = { document: { kind: 'bin' as const, id: canvasBin.id }, scopePath: [canvas.id], nodeId: childA.id };
    const targetCanvas: SavedLayer = { ...structuredClone(canvas), id: 'target-canvas', dataLink: rootAddress, dataLinkInstanceId: 'instance' };
    const cowChild: SavedLayer = {
      ...structuredClone(childA), id: 'target-a', common: { ...common, name: 'edited locally' },
      dataLinkInstanceId: 'instance', canvasStructureSource: childAddress,
    };
    const synchronized = synchronizeCanvasLinkedRecords([targetCanvas, cowChild], canvasBin, id => `target-${id}`);
    const resultCanvas = synchronized.records.find(record => record.id === targetCanvas.id)!;
    const resultA = synchronized.records.find(record => record.id === cowChild.id)!;
    const resultB = synchronized.records.find(record => record.id === 'target-child-b')!;
    expect((resultCanvas.state as { hierarchy: Array<{ layerId: string }> }).hierarchy.map(item => item.layerId))
      .toEqual(['target-a', 'target-child-b']);
    expect(resultA.common.name).toBe('edited locally');
    expect(resultA.dataLink).toBeUndefined();
    expect(resultB.dataLink?.nodeId).toBe('child-b');
  });
});
