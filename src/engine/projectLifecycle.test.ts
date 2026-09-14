import { paintRaster } from './raster/testing';
import type { RasterLayer } from './layers';
/// <reference types="node" />
// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { TRANSPARENT, type TextParams } from '../types';
import { Blob as NodeBlob } from 'node:buffer';
import { newText } from './text/model';
import { useStore } from '../state/store';
import {
  addFrame,
  frameCount,
  loadPage,
  loadProjectMeta,
  loadReferenceImage,
  saveReferenceImage,
  referenceEpoch,
} from './persistence/db';
import { layerMaskIds } from './layer-types/definition';
import type { HistoryTree, TileLayerMergeOp } from './history/historyTree';

// Real pixel buffers/PNG roundtrips without launching a browser.
const native = new WeakMap<HTMLCanvasElement, Canvas>();
function backing(node: HTMLCanvasElement): Canvas {
  let canvas = native.get(node);
  if (!canvas) {
    canvas = createCanvas(node.width, node.height);
    native.set(node, canvas);
  }
  if (canvas.width !== node.width) canvas.width = node.width;
  if (canvas.height !== node.height) canvas.height = node.height;
  return canvas;
}
vi.mock('html-to-image', () => ({
  toCanvas: vi.fn(async () => document.createElement('canvas')),
}));
let engine: (typeof import('./instance'))['engine'];
beforeAll(async () => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    function (this: HTMLCanvasElement) {
      const ctx = backing(this).getContext('2d');
      return new Proxy(ctx, {
        get(target, key) {
          if (key === 'drawImage')
            return (source: HTMLCanvasElement | Canvas, ...args: number[]) =>
              (target.drawImage as Function)(
                source instanceof HTMLCanvasElement ? backing(source) : source,
                ...args,
              );
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, key, value) {
          return Reflect.set(target, key, value, target);
        },
      }) as unknown as CanvasRenderingContext2D;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
  ) {
    void backing(this)
      .encode('png')
      .then((bytes) => callback(new Blob([new Uint8Array(bytes)])));
  });
  vi.stubGlobal('createImageBitmap', async (blob: Blob) =>
    Object.assign(await loadImage(new Uint8Array(await blob.arrayBuffer())), {
      close() {},
    }),
  );
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { load: async () => [] },
  });
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
  return [
    ...(engine.layerById(layerId) as RasterLayer).runtime.surface.readRegion({
      x,
      y,
      w: 1,
      h: 1,
    }).data,
  ];
}

describe('canvas history and new project', () => {
  it('creates a panel subtree with a deferred raster and restores it in one history step', async () => {
    await engine.newProject();
    const shape = {
      kind: 'polygon' as const,
      cx: 80,
      cy: 60,
      points: [
        { x: -50, y: -30 },
        { x: 50, y: -30 },
        { x: 50, y: 30 },
        { x: -50, y: 30 },
      ],
      rotation: 0,
      color: '#ffffff',
      strokeWidth: 0,
      paintMode: 'fill-inside' as const,
      strokeJoin: 'miter' as const,
      cornerRadius: 0,
    };
    engine.addPanelFrame(shape, { outlineColor: '#112233', outlineWidthMm: 2 });
    const panel = useStore
      .getState()
      .layers.find((layer) => layer.name === 'コマ')!;
    const [rasterId, clipId] = panel.childIds;
    const clip = useStore
      .getState()
      .layers.find((layer) => layer.id === clipId)!;
    const outline = useStore
      .getState()
      .layers.find((layer) => layer.id === clip.childIds[0])!;
    expect(useStore.getState().activeLayerId).toBe(rasterId);
    expect(clip.state).toEqual({ maskLayerIds: [panel.id] });
    expect(outline.state).toMatchObject({
      outline: { color: '#112233', widthMm: 2, cornerStyle: 'sharp' },
    });
    expect(
      (engine.layerById(rasterId) as RasterLayer).runtime.surface.tileCount,
    ).toBe(0);
    expect(internalHistory().current.op?.kind).toBe('layerReplace');
    await engine.undo();
    expect(
      useStore.getState().layers.some((layer) => layer.id === panel.id),
    ).toBe(false);
    await engine.redo();
    expect(
      useStore.getState().layers.some((layer) => layer.id === panel.id),
    ).toBe(true);
  });

  it('creates a bubble in body-tail-outline-text order with a linked tail', async () => {
    await engine.newProject();
    const body = {
      kind: 'ellipse' as const,
      cx: 100,
      cy: 100,
      rx: 60,
      ry: 40,
      rotation: 0,
      color: '#fffefe',
      strokeWidth: 0,
      paintMode: 'fill-inside' as const,
    };
    const tail = {
      kind: 'bubble-tail' as const,
      style: 'rounds' as const,
      start: { x: 60, y: 125 },
      control: { x: 40, y: 150 },
      tip: { x: 20, y: 180 },
      width: 12,
      circleCount: 4,
      spacingDecay: 0.35,
      color: '#fffefe',
      strokeWidth: 0,
      strokeJoin: 'round' as const,
    };
    engine.addSpeechBubble(body, tail, {
      outlineColor: '#000000',
      outlineWidthMm: 1,
      textColor: '#123456',
      fontId: 'serif',
      fontSizePt: 12,
      textFrame: { x: 58, y: 72, w: 84, h: 56 },
    });
    const bubble = useStore
      .getState()
      .layers.find((layer) => layer.name === '吹き出し')!;
    const children = bubble.childIds.map(
      (id) => useStore.getState().layers.find((layer) => layer.id === id)!,
    );
    expect(children.map((layer) => layer.name)).toEqual([
      'しっぽ',
      '吹き出し枠',
      '文字',
    ]);
    expect(children[0].parameterLink).toMatchObject({
      source: { layerId: bubble.id },
      linkedParameterIds: ['appearance.color'],
    });
    expect(children[1].state).toMatchObject({
      outline: { cornerStyle: 'round' },
    });
    expect(children[2].state).toMatchObject({
      text: {
        direction: 'vertical',
        horizontalAlign: 'left',
        verticalAlign: 'top',
        lineHeight: 1.5,
        width: 84,
        height: 56,
      },
    });
    expect(useStore.getState().textEditingId).toBe(children[2].id);
    await engine.undo();
    expect(
      useStore.getState().layers.some((layer) => layer.id === bubble.id),
    ).toBe(false);
    await engine.redo();
    expect(
      useStore.getState().layers.some((layer) => layer.id === bubble.id),
    ).toBe(true);
  });

  it('converts a rotated rectangle to an editable polygon without changing its identity or children', async () => {
    await engine.newProject();
    engine.addShapeLayer({
      kind: 'rect',
      x: 20,
      y: 30,
      width: 100,
      height: 60,
      rotation: Math.PI / 6,
      color: '#abcdef',
      strokeWidth: 7,
      paintMode: 'fill-outside',
    });
    const id = useStore.getState().activeLayerId;
    engine.addRasterLayer();
    const childId = useStore.getState().activeLayerId;
    engine.moveLayerAsTopChild(childId, id);
    engine.setActiveLayer(id);
    engine.convertRectToPolygon(id);
    const converted = engine.getShape(id);
    expect(converted).toMatchObject({
      kind: 'polygon',
      color: '#abcdef',
      strokeWidth: 7,
      paintMode: 'fill-outside',
    });
    expect(
      useStore.getState().layers.find((layer) => layer.id === id),
    ).toMatchObject({ name: '多角形', childIds: [childId] });
    expect(converted?.kind === 'polygon' ? converted.points : []).toHaveLength(
      4,
    );
    await engine.undo();
    expect(engine.getShape(id)).toMatchObject({
      kind: 'rect',
      rotation: Math.PI / 6,
    });
    expect(
      useStore.getState().layers.find((layer) => layer.id === id),
    ).toMatchObject({ name: '四角形', childIds: [childId] });
    await engine.redo();
    expect(engine.getShape(id)?.kind).toBe('polygon');
  });

  it('splits a rectangle and its child tree as one persistent structural history action', async () => {
    await engine.newProject();
    engine.addShapeLayer({
      kind: 'rect',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      color: '#123456',
      strokeWidth: 3,
      paintMode: 'fill-inside',
    });
    const sourceId = useStore.getState().activeLayerId;
    engine.addRasterLayer();
    const childId = useStore.getState().activeLayerId;
    engine.moveLayerAsTopChild(childId, sourceId);
    engine.setActiveLayer(sourceId);
    await (
      engine as unknown as {
        polygonSplit: {
          split(
            a: { x: number; y: number; pressure: number },
            b: { x: number; y: number; pressure: number },
          ): Promise<void>;
        };
      }
    ).polygonSplit.split(
      { x: 50, y: -20, pressure: 1 },
      { x: 50, y: 120, pressure: 1 },
    );
    const shapes = useStore
      .getState()
      .layers.filter((layer) => layer.type === 'shape');
    const rasters = useStore
      .getState()
      .layers.filter((layer) => layer.type === 'raster');
    expect(shapes).toHaveLength(2);
    expect(rasters).toHaveLength(3);
    expect(
      shapes.map((layer) => layer.type === 'shape' && layer.state.shape),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'polygon',
          paintMode: 'fill-inside',
          color: '#123456',
        }),
        expect.objectContaining({
          kind: 'polygon',
          paintMode: 'fill-inside',
          color: '#123456',
        }),
      ]),
    );
    expect(useStore.getState().selectedLayerIds).toHaveLength(2);
    expect(internalHistory().current.op?.kind).toBe('layerReplace');
    await engine.undo();
    expect(
      useStore.getState().layers.filter((layer) => layer.type === 'shape'),
    ).toHaveLength(1);
    expect(
      useStore.getState().layers.filter((layer) => layer.type === 'raster'),
    ).toHaveLength(2);
    expect(engine.getShape(sourceId)?.kind).toBe('rect');
    await engine.redo();
    expect(
      useStore.getState().layers.filter((layer) => layer.type === 'shape'),
    ).toHaveLength(2);
    expect(
      useStore.getState().layers.filter((layer) => layer.type === 'raster'),
    ).toHaveLength(3);
    await (engine as unknown as { flushSave(): Promise<void> }).flushSave();
    const { page } = await loadActivePersisted();
    expect(
      page?.history.nodes.some((node) => node.op?.kind === 'layerReplace'),
    ).toBe(true);
  });

  it('aborts the whole split when selected target polygons have an ancestor relationship', async () => {
    await engine.newProject();
    engine.addShapeLayer({
      kind: 'rect',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      color: '#000',
      strokeWidth: 2,
      paintMode: 'stroke',
    });
    const parentId = useStore.getState().activeLayerId;
    engine.addShapeLayer({
      kind: 'rect',
      x: 20,
      y: 20,
      width: 40,
      height: 40,
      color: '#000',
      strokeWidth: 2,
      paintMode: 'stroke',
    });
    const childId = useStore.getState().activeLayerId;
    engine.moveLayerAsTopChild(childId, parentId);
    engine.beginMultiSelect(parentId);
    const historyBefore = useStore.getState().historyCount;
    await (
      engine as unknown as {
        polygonSplit: {
          split(
            a: { x: number; y: number; pressure: number },
            b: { x: number; y: number; pressure: number },
          ): Promise<void>;
        };
      }
    ).polygonSplit.split(
      { x: 50, y: -20, pressure: 1 },
      { x: 50, y: 120, pressure: 1 },
    );
    expect(
      useStore.getState().layers.filter((layer) => layer.type === 'shape'),
    ).toHaveLength(2);
    expect(useStore.getState().historyCount).toBe(historyBefore);
    expect(useStore.getState().toolNotice).toContain('親子関係');
  });

  it('fills only the primary raster using mixed selected layers as the visible boundary', async () => {
    await engine.newProject();
    const rasterId = useStore.getState().activeLayerId;
    engine.addShapeLayer({
      kind: 'rect',
      x: 10,
      y: 10,
      width: 40,
      height: 40,
      rotation: 0,
      color: '#000000',
      strokeWidth: 4,
      paintMode: 'stroke',
    });
    const shapeId = useStore.getState().activeLayerId;
    const originalShape = engine.getShape(shapeId);
    engine.setActiveLayer(rasterId);
    engine.beginMultiSelect(shapeId);
    engine.setPenColor('#ff0000');
    await (
      engine as unknown as {
        fill: {
          start(point: {
            x: number;
            y: number;
            pressure: number;
          }): Promise<void>;
        };
      }
    ).fill.start({ x: 30, y: 30, pressure: 1 });
    await awaitHistoryReady();
    expect(pixel(rasterId, 30, 30)).toEqual([255, 0, 0, 255]);
    expect(pixel(rasterId, 2, 2)).toEqual([0, 0, 0, 0]);
    expect(engine.getShape(shapeId)).toEqual(originalShape);
    engine.setPenColor(TRANSPARENT);
    await (
      engine as unknown as {
        fill: {
          start(point: {
            x: number;
            y: number;
            pressure: number;
          }): Promise<void>;
        };
      }
    ).fill.start({ x: 30, y: 30, pressure: 1 });
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
      const pending = (
        engine as unknown as {
          fill: {
            start(point: {
              x: number;
              y: number;
              pressure: number;
            }): Promise<void>;
          };
        }
      ).fill.start({ x: 10, y: 10, pressure: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
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
    engine.addShapeLayer({
      kind: 'rect',
      x: 10,
      y: 20,
      width: 50,
      height: 60,
      strokeWidth: 2,
      color: '#112233',
      rotation: 0.2,
      paintMode: 'stroke',
    });
    const first = useStore.getState().activeLayerId;
    engine.addShapeLayer({
      kind: 'rect',
      x: 100,
      y: 200,
      width: 70,
      height: 80,
      strokeWidth: 5,
      color: '#445566',
      rotation: 0.8,
      paintMode: 'stroke',
    });
    const second = useStore.getState().activeLayerId;
    engine.beginMultiSelect(first);
    engine.updateSelectedShapes((shape) =>
      shape.kind === 'rect' ? { ...shape, width: 120 } : shape,
    );
    expect(engine.getShape(first)).toMatchObject({
      x: 10,
      width: 120,
      strokeWidth: 2,
      rotation: 0.2,
    });
    expect(engine.getShape(second)).toMatchObject({
      x: 100,
      width: 120,
      strokeWidth: 5,
      rotation: 0.8,
    });
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
    engine.addShapeLayer({
      kind: 'rect',
      x: 10,
      y: 10,
      width: 50,
      height: 30,
      strokeWidth: 2,
      color: '#111111',
      rotation: 0.2,
      paintMode: 'stroke',
    });
    const shapeId = useStore.getState().activeLayerId;
    const text = {
      ...newText(20, 20, '#222222'),
      content: 'ab',
      ranges: [
        { start: 0, end: 1, fontId: 'serif', color: '#333333', sizePt: 8 },
      ],
    };
    engine.addTextLayer(text);
    const textId = useStore.getState().activeLayerId;
    engine.finishTextEditing();
    engine.beginMultiSelect(shapeId);
    const count = useStore.getState().historyCount;
    engine.updateSelectedParameter('color', '#abcdef');
    expect(engine.getShape(shapeId)?.color).toBe('#abcdef');
    expect(engine.getText(textId)).toMatchObject({
      style: { color: '#abcdef' },
      ranges: [{ color: '#abcdef' }],
    });
    expect(useStore.getState().historyCount).toBe(count + 1);
    await engine.undo();
    expect(engine.getShape(shapeId)?.color).toBe('#111111');
    expect(engine.getText(textId)).toMatchObject({
      style: { color: '#222222' },
      ranges: [{ color: '#333333' }],
    });
    engine.exitMultiSelect();
    await engine.newProject();
  });
  it('restores cropped pixels, dimensions, and earlier raster history across reload', async () => {
    const id = useStore.getState().activeLayerId;
    engine.captureBefore(engine.activeRaster()!);
    engine.historyService
      .editFor(engine.activeRaster()!)
      .mutateRegion({ x: 1200, y: 900, w: 20, h: 20 }, (ctx) => {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(1200, 900, 20, 20);
      });
    engine.commitRasterEdit(
      engine.activeRaster()!,
      { minX: 1200, minY: 900, maxX: 1220, maxY: 920 },
      '描画',
    );
    engine.commitLayerProps(id, { opacity: 1 }, { opacity: 0.6 }, 'opacity');
    const smaller = {
      widthMm: (800 * 25.4) / 300,
      heightMm: (600 * 25.4) / 300,
      ppi: 300,
    };
    await engine.resizePage(smaller);
    expect(engine.artboard.w).toBe(800);
    await (engine as unknown as { flushSave(): Promise<void> }).flushSave();
    const { page: persisted } = await loadActivePersisted();
    expect(
      persisted?.history?.nodes.some((n) => n.op?.kind === 'pageChange'),
    ).toBe(true);
    const { HistoryTree } = await import('./history/historyTree');
    const restored = new HistoryTree();
    expect(restored.restore(persisted?.history)).toBe(true);
    (
      engine as unknown as { history: InstanceType<typeof HistoryTree> }
    ).history = restored;
    await engine.undo();
    expect(engine.artboard.w).toBe(1600);
    expect(pixel(id, 1205, 905)).toEqual([255, 0, 0, 255]);
    await engine.undo();
    expect(useStore.getState().layers.find((l) => l.id === id)?.opacity).toBe(
      1,
    );
    await engine.undo();
    expect(pixel(id, 1205, 905)).toEqual([0, 0, 0, 0]);
    await engine.redo();
    await engine.redo();
    await engine.redo();
    expect(engine.artboard.w).toBe(800);
  });
  it('resamples pixels, shape positions and text frames while retaining point sizes', async () => {
    await engine.newProject();
    const raster = useStore.getState().activeLayerId;
    paintRaster(engine.layerById(raster) as RasterLayer, (ctx) => {
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(10, 10, 20, 20);
    });
    engine.addShapeLayer({
      kind: 'line',
      x1: 10,
      y1: 20,
      x2: 100,
      y2: 120,
      color: '#000000',
      strokeWidth: 3,
    });
    const shapeId = useStore.getState().activeLayerId;
    const text: TextParams = {
      ...newText(30, 40, '#000000', 200, 100),
      content: '文字',
    };
    engine.addTextLayer(text);
    const textId = useStore.getState().activeLayerId;
    await engine.resizePage({ ...useStore.getState().pageSpec, ppi: 600 });
    expect(engine.artboard.w).toBe(1600);
    expect(pixel(raster, 30, 30)).toEqual([0, 255, 0, 255]);
    expect(engine.getShape(shapeId)).toMatchObject({
      x1: 20,
      y1: 40,
      strokeWidth: 6,
    });
    expect(engine.getText(textId)).toMatchObject({
      x: 60,
      y: 80,
      width: 400,
      height: 200,
      style: { sizePt: 12 },
    });
    await engine.undo();
    expect(engine.getText(textId)).toEqual(text);
    await engine.redo();
    expect(useStore.getState().pageSpec.ppi).toBe(600);
  });
  it('new project clears project data atomically and rejects delayed reference writes', async () => {
    const oldEpoch = referenceEpoch();
    const reference = {
      blob: new Blob(['image']),
      name: 'reference',
      naturalWidth: 1,
      naturalHeight: 1,
      x: 0,
      y: 0,
      width: 100,
      rotation: 0,
      opacity: 1,
      locked: false,
    };
    await saveReferenceImage(reference, oldEpoch);
    await addFrame({ t: 1, blob: new Blob(['frame']) });
    const spec = useStore.getState().pageSpec;
    const tools = structuredClone(useStore.getState().tools);
    await engine.newProject();
    await saveReferenceImage(reference, oldEpoch);
    const { meta, page } = await loadActivePersisted();
    expect(page?.layers).toHaveLength(1);
    expect(page?.history?.nodes).toHaveLength(1);
    expect(meta?.fonts).toEqual([]);
    expect(page?.pageSpec).toEqual(spec);
    expect(useStore.getState().tools).toEqual(tools);
    expect(await frameCount()).toBe(0);
    expect(await loadReferenceImage()).toBeUndefined();
    expect(useStore.getState().canUndo).toBe(false);
  });
  it('removes a whitespace-only text layer when editing ends', async () => {
    await engine.newProject();
    const text = { ...newText(10, 20, '#000000'), content: ' \n\t　' };
    engine.addTextLayer(text);
    const id = useStore.getState().activeLayerId;
    expect(useStore.getState().layers.some((layer) => layer.id === id)).toBe(
      true,
    );
    expect(engine.finishTextEditing()).toBe(true);
    expect(useStore.getState().layers.some((layer) => layer.id === id)).toBe(
      false,
    );
  });

  it('exits multi-select when the selection shrinks to one layer and batches opacity preview history', async () => {
    await engine.newProject();
    const first = useStore.getState().activeLayerId;
    engine.addRasterLayer();
    const second = useStore.getState().activeLayerId;
    engine.beginMultiSelect(first);
    expect(useStore.getState().selectedLayerIds[0]).toBe(second);
    const before = Object.fromEntries(
      useStore
        .getState()
        .selectedLayerIds.map((id) => [
          id,
          useStore.getState().layers.find((layer) => layer.id === id)!.opacity,
        ]),
    );
    engine.previewSelectedLayerProps({ opacity: 0.35 });
    engine.commitSelectedLayerOpacity(before, 0.35);
    expect(
      useStore
        .getState()
        .layers.filter((layer) => [first, second].includes(layer.id))
        .map((layer) => layer.opacity),
    ).toEqual([0.35, 0.35]);
    await engine.undo();
    expect(
      useStore
        .getState()
        .layers.filter((layer) => [first, second].includes(layer.id))
        .map((layer) => layer.opacity),
    ).toEqual([1, 1]);
    engine.setActiveLayer(second);
    expect(useStore.getState().multiSelectMode).toBe(false);
    expect(useStore.getState().selectedLayerIds).toEqual([first]);
    expect(useStore.getState().activeLayerId).toBe(first);
  });

  it('keeps multi-select when entering with a single layer', async () => {
    await engine.newProject();
    const id = useStore.getState().activeLayerId;
    engine.beginMultiSelect(id);
    expect(useStore.getState().multiSelectMode).toBe(true);
    expect(useStore.getState().selectedLayerIds).toEqual([id]);
  });

  it('selects then clears descendants from a long-pressed parent', async () => {
    await engine.newProject();
    const parentId = useStore.getState().activeLayerId;
    engine.addRasterLayer();
    const childId = useStore.getState().activeLayerId;
    engine.addRasterLayer();
    const grandChildId = useStore.getState().activeLayerId;
    engine.moveLayerAsTopChild(grandChildId, childId);
    engine.moveLayerAsTopChild(childId, parentId);
    engine.setActiveLayer(parentId);
    engine.toggleDescendantSelection(parentId);
    expect(useStore.getState().multiSelectMode).toBe(true);
    expect(useStore.getState().selectedLayerIds).toEqual([
      parentId,
      childId,
      grandChildId,
    ]);
    engine.toggleDescendantSelection(parentId);
    expect(useStore.getState().selectedLayerIds).toEqual([parentId]);
    expect(useStore.getState().activeLayerId).toBe(parentId);
    expect(useStore.getState().multiSelectMode).toBe(false);
    engine.addRasterLayer();
    const otherId = useStore.getState().activeLayerId;
    engine.setActiveLayer(parentId);
    engine.beginMultiSelect(otherId);
    engine.toggleDescendantSelection(parentId);
    engine.toggleDescendantSelection(parentId);
    expect(useStore.getState().selectedLayerIds).toEqual([otherId]);
    expect(useStore.getState().multiSelectMode).toBe(true);
  });

  it('stores raster merges as tiles-v1 across undo, redo and reload', async () => {
    await engine.newProject();
    const lowerId = useStore.getState().activeLayerId;
    paintRaster(engine.layerById(lowerId) as RasterLayer, (ctx) => {
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 100, 100);
    });
    engine.addRasterLayer();
    const upperId = useStore.getState().activeLayerId;
    paintRaster(engine.layerById(upperId) as RasterLayer, (ctx) => {
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(10, 10, 20, 20);
    });
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
    expect(mergeNode.op).toMatchObject({
      kind: 'layerMerge',
      format: 'tiles-v1',
      targetLayerId: lowerId,
    });
    const compact = mergeNode.op as TileLayerMergeOp;
    expect(compact.tiles).toHaveLength(1);
    expect(compact.removed.snapshot.id).toBe(upperId);

    await engine.undo();
    expect(pixel(lowerId, 15, 15)).toEqual([255, 0, 0, 255]);
    expect(
      useStore.getState().layers.some((layer) => layer.id === upperId),
    ).toBe(true);

    await engine.redo();
    expect(pixel(lowerId, 15, 15)).toEqual(mergedPixel);
    expect(
      useStore.getState().layers.some((layer) => layer.id === upperId),
    ).toBe(false);

    await (engine as unknown as { flushSave(): Promise<void> }).flushSave();
    const { page: persisted } = await loadActivePersisted();
    const savedMerge = persisted?.history?.nodes.find(
      (node) => node.id === mergeNode.id,
    )?.op;
    expect(savedMerge).toMatchObject({
      kind: 'layerMerge',
      format: 'tiles-v1',
    });
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
    expect(
      useStore.getState().layers.some((layer) => layer.id === upperId),
    ).toBe(true);
    expect(useStore.getState().activeLayerId).toBe(upperId);
    await engine.redo();
    expect(useStore.getState().activeLayerId).toBe(lowerId);
  });

  it('merges drawable and effect layers as tiles-v1', async () => {
    const verify = async (
      type: 'shape' | 'text' | 'adjust' | 'outline' | 'clip' | 'image',
      add: () => void,
    ) => {
      await engine.newProject();
      add();
      const upperId = useStore.getState().activeLayerId;
      await engine.mergeLayerDown(upperId);
      await awaitHistoryReady();
      const compact = internalHistory().current.op as TileLayerMergeOp;
      expect(compact).toMatchObject({ kind: 'layerMerge', format: 'tiles-v1' });
      expect(compact.removed.snapshot).toMatchObject({ id: upperId, type });
      await engine.undo();
      expect(
        useStore.getState().layers.find((layer) => layer.id === upperId)?.type,
      ).toBe(type);
      await engine.redo();
      expect(
        useStore.getState().layers.some((layer) => layer.id === upperId),
      ).toBe(false);
    };

    await verify('shape', () =>
      engine.addShapeLayer({
        kind: 'line',
        x1: 10,
        y1: 10,
        x2: 70,
        y2: 40,
        color: '#123456',
        strokeWidth: 6,
      }),
    );
    await verify('text', () =>
      engine.addTextLayer({ ...newText(20, 30, '#222222'), content: '統合' }),
    );
    await verify('adjust', () => engine.addAdjustLayer());
    await verify('outline', () => engine.addOutlineLayer());
    await verify('clip', () => engine.addClipLayer());
    await verify('image', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 6;
      canvas.height = 3;
      canvas.getContext('2d')!.fillRect(0, 0, 6, 3);
      engine.addImageLayer(canvas, 4, 5, 20, 20);
    });
  });

  it('bakes target opacity into an exact effect merge and restores it through undo/redo', async () => {
    await engine.newProject();
    const targetId = useStore.getState().activeLayerId;
    paintRaster(engine.layerById(targetId) as RasterLayer, (ctx) => {
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 1, 1);
    });
    engine.commitLayerProps(
      targetId,
      { opacity: 1 },
      { opacity: 0.5 },
      '不透明度',
    );
    engine.addAdjustLayer();
    const effectId = useStore.getState().activeLayerId;
    engine.commitLayerProps(
      effectId,
      {
        state: {
          params: { brightness: 100, contrast: 100, hue: 0, saturation: 100 },
        },
      },
      {
        state: {
          params: { brightness: 0, contrast: 100, hue: 0, saturation: 100 },
        },
      },
      '明度',
    );
    await engine.mergeLayerDown(effectId);
    await awaitHistoryReady();
    expect(
      useStore.getState().layers.find((layer) => layer.id === targetId)
        ?.opacity,
    ).toBe(1);
    expect(pixel(targetId, 0, 0)[3]).toBeGreaterThanOrEqual(127);
    expect(pixel(targetId, 0, 0)[3]).toBeLessThanOrEqual(128);
    await engine.undo();
    expect(
      useStore.getState().layers.find((layer) => layer.id === targetId)
        ?.opacity,
    ).toBe(0.5);
    expect(pixel(targetId, 0, 0)).toEqual([255, 0, 0, 255]);
    await engine.redo();
    expect(
      useStore.getState().layers.find((layer) => layer.id === targetId)
        ?.opacity,
    ).toBe(1);
  });

  it('enables effect merge only for the two exact single-raster structures', async () => {
    await engine.newProject();
    const rasterId = useStore.getState().activeLayerId;
    engine.addClipLayer();
    const effectId = useStore.getState().activeLayerId;
    expect(
      useStore.getState().layers.find((layer) => layer.id === effectId)
        ?.canMergeDown,
    ).toBe(true);
    engine.moveLayerAsTopChild(effectId, rasterId);
    expect(
      useStore.getState().layers.find((layer) => layer.id === effectId)
        ?.canMergeDown,
    ).toBe(true);
    engine.addRasterLayer();
    const extraId = useStore.getState().activeLayerId;
    engine.moveLayerAsTopChild(extraId, rasterId);
    expect(
      useStore.getState().layers.find((layer) => layer.id === effectId)
        ?.canMergeDown,
    ).toBe(false);
    engine.moveLayerAsTopChild(extraId, effectId);
    expect(
      useStore.getState().layers.find((layer) => layer.id === effectId)
        ?.canMergeDown,
    ).toBe(false);
  });

  it('detaches clip mask references on source deletion and restores both through history', async () => {
    await engine.newProject();
    const maskId = useStore.getState().activeLayerId;
    engine.addClipLayer();
    const clipId = useStore.getState().activeLayerId;
    engine.commitLayerProps(
      clipId,
      { state: { maskLayerIds: [] } },
      { state: { maskLayerIds: [maskId] } },
      'マスク',
    );
    engine.addRasterLayer();
    engine.removeLayer(maskId);
    expect(
      layerMaskIds(
        useStore.getState().layers.find((layer) => layer.id === clipId)?.state,
      ),
    ).toEqual([]);
    await engine.undo();
    expect(
      useStore.getState().layers.some((layer) => layer.id === maskId),
    ).toBe(true);
    expect(
      layerMaskIds(
        useStore.getState().layers.find((layer) => layer.id === clipId)?.state,
      ),
    ).toEqual([maskId]);
    await engine.redo();
    expect(
      layerMaskIds(
        useStore.getState().layers.find((layer) => layer.id === clipId)?.state,
      ),
    ).toEqual([]);
  });
});

describe('shape snap, constraints, and persistence', () => {
  const pt = (x: number, y: number) => ({ x, y, pressure: 1 });
  function shapeEdit() {
    return (
      engine as unknown as {
        shapeEdit: { snapGuides(): { x: number | null; y: number | null } };
      }
    ).shapeEdit;
  }
  function layerSnap(id: string) {
    return (
      engine as unknown as {
        layerService: {
          shapeById(id: string): { state: { snapEnabled: boolean } } | null;
        };
      }
    ).layerService.shapeById(id)?.state.snapEnabled;
  }

  it('creates shapes with snap on and keeps the setting through undo, save, and copy', async () => {
    await engine.newProject();
    engine.addShapeLayer({
      kind: 'rect',
      x: 40,
      y: 40,
      width: 20,
      height: 20,
      color: '#000',
      strokeWidth: 2,
      paintMode: 'stroke',
    });
    const id = useStore.getState().activeLayerId;
    expect(layerSnap(id)).toBe(true);
    engine.commitLayerProps(
      id,
      { state: { snapEnabled: true } },
      { state: { snapEnabled: false } },
      'スナップを変更',
    );
    expect(layerSnap(id)).toBe(false);
    await engine.undo();
    expect(layerSnap(id)).toBe(true);
    await engine.redo();
    expect(layerSnap(id)).toBe(false);
    await engine.copyLayers(id);
    await engine.pasteLayers();
    const shapes = useStore
      .getState()
      .layers.filter((layer) => layer.type === 'shape');
    expect(
      shapes.every(
        (layer) => layer.type === 'shape' && layer.state.snapEnabled === false,
      ),
    ).toBe(true);
    await (engine as unknown as { flushSave(): Promise<void> }).flushSave();
    const { page } = await loadActivePersisted();
    expect(
      page?.layers
        .filter((layer) => layer.type === 'shape')
        .every(
          (layer) =>
            (layer.state as { snapEnabled?: boolean }).snapEnabled === false,
        ),
    ).toBe(true);
  });

  it('snaps moves to canvas lines, skips hidden and self, and stays free when disabled', async () => {
    await engine.newProject();
    engine.addShapeLayer({
      kind: 'rect',
      x: 50,
      y: 10,
      width: 8,
      height: 8,
      color: '#000',
      strokeWidth: 1,
      paintMode: 'stroke',
    });
    const hiddenId = useStore.getState().activeLayerId;
    engine.commitLayerProps(
      hiddenId,
      { visible: true },
      { visible: false },
      '表示切替',
    );
    engine.addShapeLayer({
      kind: 'rect',
      x: 44,
      y: 200,
      width: 40,
      height: 40,
      color: '#000',
      strokeWidth: 1,
      paintMode: 'stroke',
    });
    const id = useStore.getState().activeLayerId;
    const historyBefore = useStore.getState().historyCount;
    expect(engine.beginShapeEdit(pt(64, 220))).toBe(true);
    engine.updateShapeEdit(pt(64, 220));
    expect(engine.getShape(id)).toMatchObject({ x: 44, y: 200 });
    expect(shapeEdit().snapGuides()).toEqual({ x: null, y: null });
    engine.updateShapeEdit(pt(67, 220));
    expect(engine.getShape(id)).toMatchObject({ x: 47, y: 200 });
    engine.finishShapeEdit(pt(67, 220));
    expect(useStore.getState().historyCount).toBe(historyBefore + 1);

    engine.beginShapeEdit(pt(67, 220));
    engine.updateShapeEdit(pt(100, 220));
    engine.cancelShapeEdit();
    expect(engine.getShape(id)).toMatchObject({ x: 47, y: 200 });
    expect(shapeEdit().snapGuides()).toEqual({ x: null, y: null });

    await engine.newProject();
    engine.addShapeLayer({
      kind: 'rect',
      x: 5,
      y: 80,
      width: 40,
      height: 40,
      color: '#000',
      strokeWidth: 1,
      paintMode: 'stroke',
    });
    const nearId = useStore.getState().activeLayerId;
    engine.commitLayerProps(
      nearId,
      { state: { snapEnabled: true } },
      { state: { snapEnabled: false } },
      'スナップを変更',
    );
    engine.beginShapeEdit(pt(25, 100));
    engine.updateShapeEdit(pt(28, 100));
    expect(engine.getShape(nearId)).toMatchObject({ x: 8 });
    expect(shapeEdit().snapGuides()).toEqual({ x: null, y: null });
    engine.cancelShapeEdit();
    engine.commitLayerProps(
      nearId,
      { state: { snapEnabled: false } },
      { state: { snapEnabled: true } },
      'スナップを変更',
    );
    engine.beginShapeEdit(pt(25, 100));
    engine.updateShapeEdit(pt(25, 100));
    expect(engine.getShape(nearId)).toMatchObject({ x: 0 });
    expect(shapeEdit().snapGuides().x).toBe(0);
    engine.cancelShapeEdit();
  });

  it('snaps rotate-handle angles near 90 degrees and records one history entry', async () => {
    await engine.newProject();
    engine.addShapeLayer({
      kind: 'rect',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      color: '#000',
      strokeWidth: 1,
      paintMode: 'stroke',
    });
    const id = useStore.getState().activeLayerId;
    const historyBefore = useStore.getState().historyCount;
    expect(engine.beginShapeEdit(pt(50, -28))).toBe(true);
    engine.updateShapeEdit(pt(150, 50));
    expect(engine.getShape(id)).toMatchObject({ rotation: Math.PI / 2 });
    engine.finishShapeEdit(pt(150, 50));
    expect(useStore.getState().historyCount).toBe(historyBefore + 1);

    engine.commitLayerProps(
      id,
      { state: { snapEnabled: true } },
      { state: { snapEnabled: false } },
      'スナップを変更',
    );
    const angle = (-6 * Math.PI) / 180;
    engine.beginShapeEdit(pt(50, -28));
    engine.updateShapeEdit(
      pt(50 + Math.cos(angle) * 100, 50 + Math.sin(angle) * 100),
    );
    const free = engine.getShape(id);
    expect(free && 'rotation' in free ? free.rotation : 0).not.toBeCloseTo(
      Math.PI / 2,
      5,
    );
    engine.cancelShapeEdit();
  });

  it('does not apply snap during lasso object transforms', async () => {
    await engine.newProject();
    engine.addShapeLayer({
      kind: 'rect',
      x: 5,
      y: 80,
      width: 20,
      height: 20,
      color: '#000',
      strokeWidth: 1,
      paintMode: 'stroke',
    });
    const id = useStore.getState().activeLayerId;
    const entries = engine.selectedObjectsInRect({
      minX: 0,
      minY: 0,
      maxX: 40,
      maxY: 120,
    });
    expect(entries.some((entry) => entry.id === id)).toBe(true);
    engine.previewObjectGroup(
      entries,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      [
        { x: 1, y: 0 },
        { x: 11, y: 0 },
        { x: 11, y: 10 },
        { x: 1, y: 10 },
      ],
    );
    expect(engine.getShape(id)).toMatchObject({ x: 6, y: 80 });
  });

  it('constrains polygon vertices along edges from Shift or the GUI toggle', async () => {
    await engine.newProject();
    engine.addShapeLayer({
      kind: 'polygon',
      cx: 0,
      cy: 0,
      rotation: 0,
      color: '#000',
      strokeWidth: 1,
      paintMode: 'stroke',
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 0, y: 40 },
      ],
    });
    const id = useStore.getState().activeLayerId;
    expect(engine.beginShapeEdit(pt(0, 0))).toBe(true);
    engine.updateShapeEdit(pt(10, 2), { shiftKey: true } as PointerEvent);
    expect(engine.getShape(id)).toEqual(
      expect.objectContaining({
        kind: 'polygon',
        points: [
          expect.objectContaining({ x: 10, y: 0 }),
          expect.anything(),
          expect.anything(),
        ],
      }),
    );
    engine.cancelShapeEdit();
    engine.beginShapeEdit(pt(0, 0));
    engine.setShapeHandleEdgeConstrained(true);
    engine.updateShapeEdit(pt(2, 10));
    expect(engine.getShape(id)).toEqual(
      expect.objectContaining({
        kind: 'polygon',
        points: [
          expect.objectContaining({ x: 0, y: 10 }),
          expect.anything(),
          expect.anything(),
        ],
      }),
    );
    engine.cancelShapeEdit();
    const raster = useStore
      .getState()
      .layers.find((layer) => layer.type === 'raster')!.id;
    engine.setActiveLayer(raster);
    expect(useStore.getState().shapeHandleSelected).toBe(false);
    expect(useStore.getState().shapeHandleEdgeConstrained).toBe(false);
  });

  it('snaps a polygon vertex to another visible polygon vertex and honors the snap switch', async () => {
    await engine.newProject();
    engine.addShapeLayer({
      kind: 'polygon',
      cx: 0,
      cy: 0,
      rotation: 0,
      color: '#000',
      strokeWidth: 1,
      paintMode: 'stroke',
      points: [
        { x: 100, y: 100 },
        { x: 140, y: 100 },
        { x: 100, y: 140 },
      ],
    });
    engine.addShapeLayer({
      kind: 'polygon',
      cx: 0,
      cy: 0,
      rotation: 0,
      color: '#000',
      strokeWidth: 1,
      paintMode: 'stroke',
      points: [
        { x: 20, y: 20 },
        { x: 60, y: 20 },
        { x: 20, y: 60 },
      ],
    });
    const id = useStore.getState().activeLayerId;
    engine.beginShapeEdit(pt(60, 20));
    engine.updateShapeEdit(pt(96, 98));
    expect(engine.getShape(id)).toEqual(
      expect.objectContaining({
        kind: 'polygon',
        points: [
          expect.anything(),
          expect.objectContaining({ x: 100, y: 100 }),
          expect.anything(),
        ],
      }),
    );
    engine.cancelShapeEdit();
    engine.commitLayerProps(
      id,
      { state: { snapEnabled: true } },
      { state: { snapEnabled: false } },
      'スナップを変更',
    );
    engine.beginShapeEdit(pt(60, 20));
    engine.updateShapeEdit(pt(96, 98));
    expect(engine.getShape(id)).toEqual(
      expect.objectContaining({
        kind: 'polygon',
        points: [
          expect.anything(),
          expect.objectContaining({ x: 96, y: 98 }),
          expect.anything(),
        ],
      }),
    );
    engine.cancelShapeEdit();
  });

  it('snaps polygon vertices to vertex axis lines and the same guides used by shape movement', async () => {
    await engine.newProject();
    engine.addShapeLayer({
      kind: 'rect',
      x: 200,
      y: 250,
      width: 40,
      height: 40,
      color: '#000',
      strokeWidth: 1,
      paintMode: 'stroke',
    });
    engine.addShapeLayer({
      kind: 'polygon',
      cx: 0,
      cy: 0,
      rotation: 0,
      color: '#000',
      strokeWidth: 1,
      paintMode: 'stroke',
      points: [
        { x: 100, y: 100 },
        { x: 140, y: 100 },
        { x: 100, y: 140 },
      ],
    });
    const id = useStore.getState().activeLayerId;
    engine.beginShapeEdit(pt(140, 100));
    engine.updateShapeEdit(pt(204, 137));
    expect(engine.getShape(id)).toEqual(
      expect.objectContaining({
        kind: 'polygon',
        points: [
          expect.anything(),
          expect.objectContaining({ x: 200, y: 140 }),
          expect.anything(),
        ],
      }),
    );
    expect(shapeEdit().snapGuides()).toEqual({ x: 200, y: 140 });
    engine.cancelShapeEdit();
  });

  it('merges a dragged polygon vertex when it snaps onto an adjacent vertex', async () => {
    await engine.newProject();
    engine.addShapeLayer({
      kind: 'polygon',
      cx: 0,
      cy: 0,
      rotation: 0,
      color: '#000',
      strokeWidth: 1,
      paintMode: 'stroke',
      points: [
        { x: 20, y: 20 },
        { x: 60, y: 20 },
        { x: 60, y: 60 },
        { x: 20, y: 60 },
      ],
    });
    const id = useStore.getState().activeLayerId;
    engine.beginShapeEdit(pt(60, 20));
    engine.updateShapeEdit(pt(23, 22));
    engine.finishShapeEdit(pt(23, 22));
    const shape = engine.getShape(id);
    expect(shape?.kind).toBe('polygon');
    expect(shape && shape.kind === 'polygon' ? shape.points : []).toHaveLength(
      3,
    );
    await engine.undo();
    const restored = engine.getShape(id);
    expect(
      restored && restored.kind === 'polygon' ? restored.points : [],
    ).toHaveLength(4);
  });

  it('constrains rectangle and ellipse corner transforms along their original edges', async () => {
    await engine.newProject();
    engine.addShapeLayer({
      kind: 'rect',
      x: 20,
      y: 20,
      width: 40,
      height: 30,
      rotation: 0,
      color: '#000',
      strokeWidth: 1,
      paintMode: 'stroke',
    });
    const rectId = useStore.getState().activeLayerId;
    engine.beginShapeEdit(pt(20, 20));
    engine.setShapeHandleEdgeConstrained(true);
    engine.updateShapeEdit(pt(35, 23));
    expect(engine.getShape(rectId)).toMatchObject({
      kind: 'rect',
      x: 35,
      y: 20,
      width: 25,
      height: 30,
    });
    engine.finishShapeEdit(pt(35, 23));

    engine.addShapeLayer({
      kind: 'ellipse',
      cx: 100,
      cy: 100,
      rx: 20,
      ry: 10,
      rotation: 0,
      color: '#000',
      strokeWidth: 1,
      paintMode: 'stroke',
    });
    const ellipseId = useStore.getState().activeLayerId;
    engine.beginShapeEdit(pt(80, 90));
    engine.setShapeHandleEdgeConstrained(true);
    engine.updateShapeEdit(pt(83, 82));
    expect(engine.getShape(ellipseId)).toMatchObject({
      kind: 'ellipse',
      cx: 100,
      cy: 96,
      rx: 20,
      ry: 14,
    });
    engine.cancelShapeEdit();
  });

  it('creates the same square from Shift and the GUI aspect lock', async () => {
    await engine.newProject();
    const { ShapeTool } = await import('../tools/shape/tool');
    const tool = new ShapeTool(engine, 'rect');
    tool.onDown(pt(10, 20), { shiftKey: true } as PointerEvent);
    tool.onUp(pt(18, 25), { shiftKey: true } as PointerEvent);
    const shifted = engine.getShape(useStore.getState().activeLayerId);
    useStore.getState().addTool('rect');
    engine.updateActiveToolSettings({ constrainAspect: true });
    const locked = new ShapeTool(engine, 'rect');
    locked.onDown(pt(10, 20), { shiftKey: false } as PointerEvent);
    locked.onUp(pt(18, 25), { shiftKey: false } as PointerEvent);
    const fromGui = engine.getShape(useStore.getState().activeLayerId);
    expect(shifted).toMatchObject({ kind: 'rect', width: 8, height: 8 });
    expect(fromGui).toMatchObject({ kind: 'rect', width: 8, height: 8 });
  });
});

describe('selection and layer transform', () => {
  const pt = (x: number, y: number) => ({ x, y, pressure: 1 });

  function activateKind(kind: 'lasso' | 'move'): void {
    const existing = useStore
      .getState()
      .tools.find((tool) => tool.kind === kind);
    if (existing) engine.selectToolInstance(existing.id);
    else engine.addToolInstance(kind);
  }

  it('still floats a lassoed raster and commits the moved pixels', async () => {
    await engine.newProject();
    const rasterId = useStore.getState().activeLayerId;
    paintRaster(engine.layerById(rasterId) as RasterLayer, (ctx) => {
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(10, 10, 20, 20);
    });
    activateKind('lasso');
    const lasso = engine.lasso;
    lasso.onDown(pt(5, 5));
    lasso.onMove(pt(40, 5));
    lasso.onMove(pt(40, 40));
    lasso.onMove(pt(5, 40));
    lasso.onUp();
    expect(useStore.getState().selectionActive).toBe(true);
    lasso.onDown(pt(20, 20));
    lasso.onMove(pt(40, 20));
    lasso.onUp();
    engine.commitFloatSelection();
    await awaitHistoryReady();
    expect(pixel(rasterId, 15, 15)[3]).toBe(0);
    expect(pixel(rasterId, 35, 15)[0]).toBeGreaterThan(200);
  });

  it('floats selected raster and shape layers when the move tool is activated', async () => {
    await engine.newProject();
    const rasterId = useStore.getState().activeLayerId;
    paintRaster(engine.layerById(rasterId) as RasterLayer, (ctx) => {
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(10, 10, 20, 20);
    });
    engine.addShapeLayer({
      kind: 'rect',
      x: 40,
      y: 40,
      width: 20,
      height: 20,
      color: '#00ff00',
      strokeWidth: 1,
      paintMode: 'fill-inside',
    });
    const shapeId = useStore.getState().activeLayerId;
    engine.beginMultiSelect(rasterId);
    activateKind('move');
    expect(useStore.getState().selectionActive).toBe(true);
    const move = engine.move;
    move.onDown(pt(25, 25));
    move.onMove(pt(45, 25));
    move.onUp();
    engine.commitFloatSelection();
    await awaitHistoryReady();
    expect(pixel(rasterId, 15, 15)[3]).toBe(0);
    expect(pixel(rasterId, 35, 15)[0]).toBeGreaterThan(200);
    expect(engine.getShape(shapeId)).toMatchObject({ x: 60, y: 40 });
  });
});

describe('outside raster lifecycle', () => {
  it('merges outside pixels, saves them and restores the removed layer with undo', async () => {
    await engine.newProject();
    const lower = useStore.getState().activeLayerId;
    paintRaster(
      engine.layerById(lower) as RasterLayer,
      (ctx) => {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(-20, -20, 2, 2);
      },
      { x: -20, y: -20, w: 2, h: 2 },
    );
    engine.addRasterLayer();
    const upper = useStore.getState().activeLayerId;
    paintRaster(
      engine.layerById(upper) as RasterLayer,
      (ctx) => {
        ctx.fillStyle = '#0000ff';
        ctx.fillRect(1000000, 10, 2, 2);
      },
      { x: 1000000, y: 10, w: 2, h: 2 },
    );
    await engine.mergeLayerDown(upper);
    expect(pixel(lower, -20, -20)).toEqual([255, 0, 0, 255]);
    expect(pixel(lower, 1000000, 10)).toEqual([0, 0, 255, 255]);
    await engine.flushSave();
    const { page } = await loadActivePersisted();
    expect(page?.layers.find((l) => l.id === lower)?.content).toMatchObject({
      kind: 'raster-tiles',
    });
    await engine.undo();
    expect(pixel(lower, 1000000, 10)[3]).toBe(0);
    expect(pixel(upper, 1000000, 10)[3]).toBe(255);
    await engine.redo();
    expect(pixel(lower, 1000000, 10)[3]).toBe(255);
  });
  it('recovers a one-pixel layer from outside through the GUI command', async () => {
    await engine.newProject();
    const id = useStore.getState().activeLayerId;
    paintRaster(
      engine.layerById(id) as RasterLayer,
      (ctx) => ctx.fillRect(-500, -500, 1, 1),
      { x: -500, y: -500, w: 1, h: 1 },
    );
    expect(engine.hasOutsideContent(id)).toBe(true);
    engine.centerSelectedContent();
    expect(engine.hasOutsideContent(id)).toBe(false);
    expect(
      pixel(
        id,
        Math.round(engine.artboard.w / 2 - 0.5),
        Math.round(engine.artboard.h / 2 - 0.5),
      )[3],
    ).toBe(255);
    await engine.undo();
    expect(pixel(id, -500, -500)[3]).toBe(255);
  });
  it('retains outside shape and image content when transferred to raster', async () => {
    await engine.newProject();
    const id = useStore.getState().activeLayerId;
    engine.addShapeLayer({
      kind: 'rect',
      x: -15,
      y: -15,
      width: 10,
      height: 10,
      color: '#ff0000',
      strokeWidth: 0,
      paintMode: 'fill-inside',
    });
    engine.transferShapeLayer();
    expect(pixel(id, -10, -10)).toEqual([255, 0, 0, 255]);
    const image = document.createElement('canvas');
    image.width = image.height = 10;
    const ctx = image.getContext('2d')!;
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 10, 10);
    engine.setActiveLayer(id);
    engine.addImageLayer(image, -100, -100, 10, 10);
    engine.transferShapeLayer();
    const layer = engine.layerById(id) as RasterLayer;
    expect(layer.runtime.surface.getContentBounds()!.x).toBeLessThan(-50);
    await engine.undo();
    expect(pixel(id, -10, -10)).toEqual([255, 0, 0, 255]);
  });
});
