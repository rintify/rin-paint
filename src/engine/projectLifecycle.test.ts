/// <reference types="node" />
// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { TRANSPARENT, type TextParams } from '../types';
import { Blob as NodeBlob } from 'node:buffer';
import { newText } from './text/model';
import { useStore } from '../state/store';
import { addFrame, frameCount, loadPage, loadProjectMeta, loadReferenceImage, saveReferenceImage, referenceEpoch } from './persistence/db';
import type { HistoryTree, TileLayerMergeOp } from './history/historyTree';

// Real pixel buffers/PNG roundtrips without launching a browser.
const native = new WeakMap<HTMLCanvasElement, Canvas>();
function backing(node: HTMLCanvasElement): Canvas {
  let canvas = native.get(node);
  if (!canvas) { canvas = createCanvas(node.width, node.height); native.set(node, canvas); }
  if (canvas.width !== node.width) canvas.width = node.width;
  if (canvas.height !== node.height) canvas.height = node.height;
  return canvas;
}
vi.mock('html-to-image', () => ({ toCanvas: vi.fn(async () => document.createElement('canvas')) }));
let engine: typeof import('./instance')['engine'];
beforeAll(async () => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const ctx = backing(this).getContext('2d');
    return new Proxy(ctx, {
      get(target, key) {
        if (key === 'drawImage') return (source: HTMLCanvasElement | Canvas, ...args: number[]) => (target.drawImage as Function)(source instanceof HTMLCanvasElement ? backing(source) : source, ...args);
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, key, value) { return Reflect.set(target, key, value, target); },
    }) as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback: BlobCallback) {
    void backing(this).encode('png').then(bytes => callback(new Blob([new Uint8Array(bytes)])));
  });
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => Object.assign(await loadImage(new Uint8Array(await blob.arrayBuffer())), { close() {} }));
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load: async () => [] } });
  engine = (await import('./instance')).engine;
  await (engine as unknown as { init(): Promise<void> }).init();
  engine.syncStore();
  engine.setTimelapseEnabled(false);
});
afterAll(() => vi.restoreAllMocks());

function internalHistory(): HistoryTree {
  return (engine as unknown as { history: HistoryTree }).history;
}

async function awaitHistoryReady(): Promise<void> {
  const node = internalHistory().current;
  if (node.ready) await node.ready;
}

async function loadActivePersisted() {
  const meta = await loadProjectMeta();
  const page = meta ? await loadPage(meta.activePageId) : undefined;
  return { meta, page };
}

function pixel(layerId: string, x: number, y: number): number[] {
  return [...engine.getLayerCanvas(layerId)!.getContext('2d')!.getImageData(x, y, 1, 1).data];
}

describe('canvas history and new project', () => {
  it('converts a rotated rectangle to an editable polygon without changing its identity or children', async () => {
    await engine.newProject();
    engine.addShapeLayer({ kind: 'rect', x: 20, y: 30, width: 100, height: 60, rotation: Math.PI / 6, color: '#abcdef', strokeWidth: 7, paintMode: 'fill-outside' });
    const id = useStore.getState().activeLayerId;
    engine.addRasterLayer();
    const childId = useStore.getState().activeLayerId;
    engine.moveLayerAsTopChild(childId, id);
    engine.setActiveLayer(id);
    engine.convertRectToPolygon(id);
    const converted = engine.getShape(id);
    expect(converted).toMatchObject({ kind: 'polygon', color: '#abcdef', strokeWidth: 7, paintMode: 'fill-outside' });
    expect(useStore.getState().layers.find(layer => layer.id === id)).toMatchObject({ name: '多角形', childIds: [childId] });
    expect(converted?.kind === 'polygon' ? converted.points : []).toHaveLength(4);
    await engine.undo();
    expect(engine.getShape(id)).toMatchObject({ kind: 'rect', rotation: Math.PI / 6 });
    expect(useStore.getState().layers.find(layer => layer.id === id)).toMatchObject({ name: '四角形', childIds: [childId] });
    await engine.redo();
    expect(engine.getShape(id)?.kind).toBe('polygon');
  });

  it('splits a rectangle and its child tree as one persistent structural history action', async () => {
    await engine.newProject();
    engine.addShapeLayer({ kind: 'rect', x: 0, y: 0, width: 100, height: 100, rotation: 0, color: '#123456', strokeWidth: 3, paintMode: 'fill-inside' });
    const sourceId = useStore.getState().activeLayerId;
    engine.addRasterLayer();
    const childId = useStore.getState().activeLayerId;
    engine.moveLayerAsTopChild(childId, sourceId);
    engine.setActiveLayer(sourceId);
    await (engine as unknown as { polygonSplit: { split(a: { x: number; y: number; pressure: number }, b: { x: number; y: number; pressure: number }): Promise<void> } }).polygonSplit.split(
      { x: 50, y: -20, pressure: 1 },
      { x: 50, y: 120, pressure: 1 },
    );
    const shapes = useStore.getState().layers.filter(layer => layer.type === 'shape');
    const rasters = useStore.getState().layers.filter(layer => layer.type === 'raster');
    expect(shapes).toHaveLength(2);
    expect(rasters).toHaveLength(3);
    expect(shapes.map(layer => layer.shape)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'polygon', paintMode: 'fill-inside', color: '#123456' }),
      expect.objectContaining({ kind: 'polygon', paintMode: 'fill-inside', color: '#123456' }),
    ]));
    expect(useStore.getState().selectedLayerIds).toHaveLength(2);
    expect(internalHistory().current.op?.kind).toBe('layerReplace');
    await engine.undo();
    expect(useStore.getState().layers.filter(layer => layer.type === 'shape')).toHaveLength(1);
    expect(useStore.getState().layers.filter(layer => layer.type === 'raster')).toHaveLength(2);
    expect(engine.getShape(sourceId)?.kind).toBe('rect');
    await engine.redo();
    expect(useStore.getState().layers.filter(layer => layer.type === 'shape')).toHaveLength(2);
    expect(useStore.getState().layers.filter(layer => layer.type === 'raster')).toHaveLength(3);
    await (engine as unknown as { flushSave(): Promise<void> }).flushSave();
    const { page } = await loadActivePersisted();
    expect(page?.history.nodes.some(node => node.op?.kind === 'layerReplace')).toBe(true);
  });

  it('aborts the whole split when selected target polygons have an ancestor relationship', async () => {
    await engine.newProject();
    engine.addShapeLayer({ kind: 'rect', x: 0, y: 0, width: 100, height: 100, color: '#000', strokeWidth: 2, paintMode: 'stroke' });
    const parentId = useStore.getState().activeLayerId;
    engine.addShapeLayer({ kind: 'rect', x: 20, y: 20, width: 40, height: 40, color: '#000', strokeWidth: 2, paintMode: 'stroke' });
    const childId = useStore.getState().activeLayerId;
    engine.moveLayerAsTopChild(childId, parentId);
    engine.beginMultiSelect(parentId);
    const historyBefore = useStore.getState().historyCount;
    await (engine as unknown as { polygonSplit: { split(a: { x: number; y: number; pressure: number }, b: { x: number; y: number; pressure: number }): Promise<void> } }).polygonSplit.split(
      { x: 50, y: -20, pressure: 1 },
      { x: 50, y: 120, pressure: 1 },
    );
    expect(useStore.getState().layers.filter(layer => layer.type === 'shape')).toHaveLength(2);
    expect(useStore.getState().historyCount).toBe(historyBefore);
    expect(useStore.getState().toolNotice).toContain('親子関係');
  });

  it('fills only the primary raster using mixed selected layers as the visible boundary', async () => {
    await engine.newProject();
    const rasterId = useStore.getState().activeLayerId;
    engine.addShapeLayer({ kind: 'rect', x: 10, y: 10, width: 40, height: 40, rotation: 0, color: '#000000', strokeWidth: 4, paintMode: 'stroke' });
    const shapeId = useStore.getState().activeLayerId;
    const originalShape = engine.getShape(shapeId);
    engine.beginMultiSelect(rasterId);
    engine.setPenColor('#ff0000');
    await (engine as unknown as { fill: { start(point: { x: number; y: number; pressure: number }): Promise<void> } }).fill.start({ x: 30, y: 30, pressure: 1 });
    await awaitHistoryReady();
    expect(pixel(rasterId, 30, 30)).toEqual([255, 0, 0, 255]);
    expect(pixel(rasterId, 2, 2)).toEqual([0, 0, 0, 0]);
    expect(engine.getShape(shapeId)).toEqual(originalShape);
    engine.setPenColor(TRANSPARENT);
    await (engine as unknown as { fill: { start(point: { x: number; y: number; pressure: number }): Promise<void> } }).fill.start({ x: 30, y: 30, pressure: 1 });
    await awaitHistoryReady();
    expect(pixel(rasterId, 30, 30)).toEqual([0, 0, 0, 0]);
    await engine.undo();
    expect(pixel(rasterId, 30, 30)).toEqual([255, 0, 0, 255]);
  });

  it('discards a cancelled worker fill without pixels or history', async () => {
    await engine.newProject();
    const rasterId = useStore.getState().activeLayerId;
    const historyBefore = useStore.getState().historyCount;
    const previousWorker = globalThis.Worker;
    class PendingWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', PendingWorker as unknown as typeof Worker);
    try {
      const pending = (engine as unknown as { fill: { start(point: { x: number; y: number; pressure: number }): Promise<void> } }).fill.start({ x: 10, y: 10, pressure: 1 });
      await new Promise(resolve => setTimeout(resolve, 0));
      engine.cancelFill();
      await pending;
      expect(pixel(rasterId, 10, 10)).toEqual([0, 0, 0, 0]);
      expect(useStore.getState().historyCount).toBe(historyBefore);
    } finally {
      vi.stubGlobal('Worker', previousWorker);
    }
  });

  it('updates multiple rectangles without replacing their unrelated parameters, in one undo step', async () => {
    await engine.newProject();
    engine.addShapeLayer({ kind: 'rect', x: 10, y: 20, width: 50, height: 60, strokeWidth: 2, color: '#112233', rotation: .2, paintMode: 'stroke' });
    const first = useStore.getState().activeLayerId;
    engine.addShapeLayer({ kind: 'rect', x: 100, y: 200, width: 70, height: 80, strokeWidth: 5, color: '#445566', rotation: .8, paintMode: 'stroke' });
    const second = useStore.getState().activeLayerId;
    engine.beginMultiSelect(first);
    engine.updateSelectedShapes(shape => shape.kind === 'rect' ? { ...shape, width: 120 } : shape);
    expect(engine.getShape(first)).toMatchObject({ x: 10, width: 120, strokeWidth: 2, rotation: .2 });
    expect(engine.getShape(second)).toMatchObject({ x: 100, width: 120, strokeWidth: 5, rotation: .8 });
    await engine.undo();
    expect(engine.getShape(first)).toMatchObject({ width: 50 });
    expect(engine.getShape(second)).toMatchObject({ width: 70 });
    await engine.redo();
    expect(engine.getShape(first)).toMatchObject({ width: 120 });
    expect(engine.getShape(second)).toMatchObject({ width: 120 });
    engine.exitMultiSelect();
    await engine.newProject();
  });
  it('updates semantic color across shape and complete rich text in one history step', async () => {
    await engine.newProject();
    engine.addShapeLayer({ kind: 'rect', x: 10, y: 10, width: 50, height: 30, strokeWidth: 2, color: '#111111', rotation: .2, paintMode: 'stroke' });
    const shapeId = useStore.getState().activeLayerId;
    const text = { ...newText(20, 20, '#222222'), content: 'ab', ranges: [{ start: 0, end: 1, fontId: 'serif', color: '#333333', sizePt: 8 }] };
    engine.addTextLayer(text);
    const textId = useStore.getState().activeLayerId;
    engine.finishTextEditing();
    engine.beginMultiSelect(shapeId);
    const count = useStore.getState().historyCount;
    engine.updateSelectedParameter('color', '#abcdef');
    expect(engine.getShape(shapeId)?.color).toBe('#abcdef');
    expect(engine.getText(textId)).toMatchObject({ style: { color: '#abcdef' }, ranges: [{ color: '#abcdef' }] });
    expect(useStore.getState().historyCount).toBe(count + 1);
    await engine.undo();
    expect(engine.getShape(shapeId)?.color).toBe('#111111');
    expect(engine.getText(textId)).toMatchObject({ style: { color: '#222222' }, ranges: [{ color: '#333333' }] });
    engine.exitMultiSelect();
    await engine.newProject();
  });
  it('restores cropped pixels, dimensions, and earlier raster history across reload', async () => {
    const id = useStore.getState().activeLayerId;
    const canvas = engine.getLayerCanvas(id)!;
    const ctx = canvas.getContext('2d')!;
    engine.captureBefore(engine.activeRaster()!);
    ctx.fillStyle = '#ff0000'; ctx.fillRect(1200, 900, 20, 20);
    engine.commitRasterEdit(engine.activeRaster()!, { minX: 1200, minY: 900, maxX: 1220, maxY: 920 }, '描画');
    engine.commitLayerProps(id, { opacity: 1 }, { opacity: .6 }, 'opacity');
    const smaller = { widthMm: 800 * 25.4 / 300, heightMm: 600 * 25.4 / 300, ppi: 300 };
    await engine.resizeCanvas(smaller);
    expect(engine.getLayerCanvas(id)!.width).toBe(800);
    await (engine as unknown as { flushSave(): Promise<void> }).flushSave();
    const { page: persisted } = await loadActivePersisted();
    expect(persisted?.history?.nodes.some(n => n.op?.kind === 'canvasChange')).toBe(true);
    const { HistoryTree } = await import('./history/historyTree');
    const restored = new HistoryTree();
    expect(restored.restore(persisted?.history)).toBe(true);
    (engine as unknown as { history: InstanceType<typeof HistoryTree> }).history = restored;
    await engine.undo();
    expect(engine.getLayerCanvas(id)!.width).toBe(1600);
    expect([...engine.getLayerCanvas(id)!.getContext('2d')!.getImageData(1205, 905, 1, 1).data]).toEqual([255, 0, 0, 255]);
    await engine.undo();
    expect(useStore.getState().layers.find(l => l.id === id)?.opacity).toBe(1);
    await engine.undo();
    expect([...engine.getLayerCanvas(id)!.getContext('2d')!.getImageData(1205, 905, 1, 1).data]).toEqual([0, 0, 0, 0]);
    await engine.redo(); await engine.redo(); await engine.redo();
    expect(engine.getLayerCanvas(id)!.width).toBe(800);
  });
  it('resamples pixels, shape positions and text frames while retaining point sizes', async () => {
    await engine.newProject();
    const raster = useStore.getState().activeLayerId;
    const ctx = engine.getLayerCanvas(raster)!.getContext('2d')!;
    ctx.fillStyle = '#00ff00'; ctx.fillRect(10, 10, 20, 20);
    engine.addShapeLayer({ kind: 'line', x1: 10, y1: 20, x2: 100, y2: 120, color: '#000000', strokeWidth: 3 });
    const shapeId = useStore.getState().activeLayerId;
    const text: TextParams = { ...newText(30, 40, '#000000', 200, 100), content: '文字' };
    engine.addTextLayer(text);
    const textId = useStore.getState().activeLayerId;
    await engine.resizeCanvas({ ...useStore.getState().canvasSpec, ppi: 600 });
    expect(engine.getLayerCanvas(raster)!.width).toBe(1600);
    expect([...engine.getLayerCanvas(raster)!.getContext('2d')!.getImageData(30, 30, 1, 1).data]).toEqual([0, 255, 0, 255]);
    expect(engine.getShape(shapeId)).toMatchObject({ x1: 20, y1: 40, strokeWidth: 6 });
    expect(engine.getText(textId)).toMatchObject({ x: 60, y: 80, width: 400, height: 200, style: { sizePt: 12 } });
    await engine.undo();
    expect(engine.getText(textId)).toEqual(text);
    await engine.redo();
    expect(useStore.getState().canvasSpec.ppi).toBe(600);
  });
  it('new project clears project data atomically and rejects delayed reference writes', async () => {
    const oldEpoch = referenceEpoch();
    const reference = { blob: new Blob(['image']), name: 'reference', naturalWidth: 1, naturalHeight: 1, x: 0, y: 0, width: 100, rotation: 0, opacity: 1, locked: false };
    await saveReferenceImage(reference, oldEpoch);
    await addFrame({ t: 1, blob: new Blob(['frame']) });
    const spec = useStore.getState().canvasSpec;
    const tools = structuredClone(useStore.getState().tools);
    await engine.newProject();
    await saveReferenceImage(reference, oldEpoch);
    const { meta, page } = await loadActivePersisted();
    expect(page?.layers).toHaveLength(1);
    expect(page?.history?.nodes).toHaveLength(1);
    expect(meta?.fonts).toEqual([]);
    expect(page?.canvasSpec).toEqual(spec);
    expect(meta?.tools).toEqual(tools);
    expect(await frameCount()).toBe(0);
    expect(await loadReferenceImage()).toBeUndefined();
    expect(useStore.getState().canUndo).toBe(false);
  });
  it('removes a whitespace-only text layer when editing ends', async () => {
    await engine.newProject();
    const text = { ...newText(10, 20, '#000000'), content: ' \n\t　' };
    engine.addTextLayer(text);
    const id = useStore.getState().activeLayerId;
    expect(useStore.getState().layers.some(layer => layer.id === id)).toBe(true);
    expect(engine.finishTextEditing()).toBe(true);
    expect(useStore.getState().layers.some(layer => layer.id === id)).toBe(false);
  });

  it('keeps explicit multi-select mode with one layer and batches opacity preview history', async () => {
    await engine.newProject();
    const first = useStore.getState().activeLayerId;
    engine.addRasterLayer();
    const second = useStore.getState().activeLayerId;
    engine.beginMultiSelect(first);
    const before = Object.fromEntries(useStore.getState().selectedLayerIds.map(id => [id, useStore.getState().layers.find(layer => layer.id === id)!.opacity]));
    engine.previewSelectedLayerProps({ opacity: .35 });
    engine.commitSelectedLayerOpacity(before, .35);
    expect(useStore.getState().layers.filter(layer => [first, second].includes(layer.id)).map(layer => layer.opacity)).toEqual([.35, .35]);
    await engine.undo();
    expect(useStore.getState().layers.filter(layer => [first, second].includes(layer.id)).map(layer => layer.opacity)).toEqual([1, 1]);
    engine.setActiveLayer(second);
    expect(useStore.getState().multiSelectMode).toBe(true);
    expect(useStore.getState().selectedLayerIds).toEqual([first]);
    expect(useStore.getState().activeLayerId).toBe(first);
  });

  it('stores raster merges as tiles-v1 across undo, redo and reload', async () => {
    await engine.newProject();
    const lowerId = useStore.getState().activeLayerId;
    const lower = engine.getLayerCanvas(lowerId)!;
    lower.getContext('2d')!.fillStyle = '#ff0000';
    lower.getContext('2d')!.fillRect(0, 0, 100, 100);
    engine.addRasterLayer();
    const upperId = useStore.getState().activeLayerId;
    const upper = engine.getLayerCanvas(upperId)!;
    upper.getContext('2d')!.fillStyle = '#0000ff';
    upper.getContext('2d')!.fillRect(10, 10, 20, 20);
    engine.commitLayerProps(
      upperId,
      { opacity: 1, blend: 'source-over' },
      { opacity: 0.5, blend: 'screen' },
      '合成設定',
    );

    await engine.mergeLayerDown(upperId);
    await awaitHistoryReady();
    const mergedPixel = pixel(lowerId, 15, 15);
    const mergeNode = internalHistory().current;
    expect(mergeNode.op).toMatchObject({ kind: 'layerMerge', format: 'tiles-v1', targetLayerId: lowerId });
    const compact = mergeNode.op as TileLayerMergeOp;
    expect(compact.tiles).toHaveLength(1);
    expect(compact.removed.snapshot.id).toBe(upperId);

    await engine.undo();
    expect(pixel(lowerId, 15, 15)).toEqual([255, 0, 0, 255]);
    expect(useStore.getState().layers.some(layer => layer.id === upperId)).toBe(true);

    await engine.redo();
    expect(pixel(lowerId, 15, 15)).toEqual(mergedPixel);
    expect(useStore.getState().layers.some(layer => layer.id === upperId)).toBe(false);

    await (engine as unknown as { flushSave(): Promise<void> }).flushSave();
    const { page: persisted } = await loadActivePersisted();
    const savedMerge = persisted?.history?.nodes.find(node => node.id === mergeNode.id)?.op;
    expect(savedMerge).toMatchObject({ kind: 'layerMerge', format: 'tiles-v1' });
    const restored = new (await import('./history/historyTree')).HistoryTree();
    expect(restored.restore(persisted?.history)).toBe(true);
    (engine as unknown as { history: HistoryTree }).history = restored;
    await engine.undo();
    expect(pixel(lowerId, 15, 15)).toEqual([255, 0, 0, 255]);
    await engine.redo();
    expect(pixel(lowerId, 15, 15)).toEqual(mergedPixel);
  });

  it('stores no changed tiles when merging a transparent raster', async () => {
    await engine.newProject();
    const lowerId = useStore.getState().activeLayerId;
    engine.addRasterLayer();
    const upperId = useStore.getState().activeLayerId;
    await engine.mergeLayerDown(upperId);
    await awaitHistoryReady();
    const mergeNode = internalHistory().current;
    expect((mergeNode.op as TileLayerMergeOp).tiles).toHaveLength(0);
    await engine.undo();
    expect(useStore.getState().layers.some(layer => layer.id === upperId)).toBe(true);
    expect(useStore.getState().activeLayerId).toBe(upperId);
    await engine.redo();
    expect(useStore.getState().activeLayerId).toBe(lowerId);
  });

  it('merges shape, text and adjustment layers as tiles-v1', async () => {
    const verify = async (type: 'shape' | 'text' | 'adjust', add: () => void) => {
      await engine.newProject();
      add();
      const upperId = useStore.getState().activeLayerId;
      await engine.mergeLayerDown(upperId);
      await awaitHistoryReady();
      const compact = internalHistory().current.op as TileLayerMergeOp;
      expect(compact).toMatchObject({ kind: 'layerMerge', format: 'tiles-v1' });
      expect(compact.removed.snapshot).toMatchObject({ id: upperId, type });
      await engine.undo();
      expect(useStore.getState().layers.find(layer => layer.id === upperId)?.type).toBe(type);
      await engine.redo();
      expect(useStore.getState().layers.some(layer => layer.id === upperId)).toBe(false);
    };

    await verify('shape', () => engine.addShapeLayer({ kind: 'line', x1: 10, y1: 10, x2: 70, y2: 40, color: '#123456', strokeWidth: 6 }));
    await verify('text', () => engine.addTextLayer({ ...newText(20, 30, '#222222'), content: '統合' }));
    await verify('adjust', () => engine.addAdjustLayer());
  });
});
