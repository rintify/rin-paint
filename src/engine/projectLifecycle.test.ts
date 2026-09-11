/// <reference types="node" />
// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { type TextParams } from '../types';
import { Blob as NodeBlob } from 'node:buffer';
import { newText } from './text/model';
import { useStore } from '../state/store';
import { addFrame, frameCount, loadProject, loadReferenceImage, saveReferenceImage, referenceEpoch } from './persistence/db';

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
let engine: typeof import('./PaintEngine')['engine'];
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
  engine = (await import('./PaintEngine')).engine;
  await (engine as unknown as { init(): Promise<void> }).init();
  engine.syncStore();
  engine.setTimelapseEnabled(false);
});
afterAll(() => vi.restoreAllMocks());

describe('canvas history and new project', () => {
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
    const persisted = await loadProject();
    expect(persisted?.history?.nodes.some(n => n.op?.kind === 'canvasChange')).toBe(true);
    // Restore the serialized history, exercising decoded PNG payloads rather than retained canvases.
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
    engine.addShapeLayer({ kind: 'line', x1: 10, y1: 20, x2: 100, y2: 120, color: '#000000', width: 3 });
    const shapeId = useStore.getState().activeLayerId;
    const text: TextParams = { ...newText(30, 40, '#000000', 200, 100), content: '文字' };
    engine.addTextLayer(text);
    const textId = useStore.getState().activeLayerId;
    await engine.resizeCanvas({ ...useStore.getState().canvasSpec, ppi: 600 });
    expect(engine.getLayerCanvas(raster)!.width).toBe(1600);
    expect([...engine.getLayerCanvas(raster)!.getContext('2d')!.getImageData(30, 30, 1, 1).data]).toEqual([0, 255, 0, 255]);
    expect(engine.getShape(shapeId)).toMatchObject({ x1: 20, y1: 40, width: 6 });
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
    const saved = await loadProject();
    expect(saved?.layers).toHaveLength(1);
    expect(saved?.history?.nodes).toHaveLength(1);
    expect(saved?.fonts).toEqual([]);
    expect(saved?.canvasSpec).toEqual(spec);
    expect(saved?.tools).toEqual(tools);
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
});
