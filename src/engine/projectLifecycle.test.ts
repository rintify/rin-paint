import { layerChildren } from './layerTree';
/// <reference types="node" />
// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage, Path2D, type Canvas } from '@napi-rs/canvas';
import { TRANSPARENT, type TextParams } from '../types';
import { Blob as NodeBlob } from 'node:buffer';
import { newText } from './text/model';
import { useStore } from '../state/store';
import { addFrame, frameCount, loadPage, loadProjectMeta, loadReferenceImage, saveReferenceImage, referenceEpoch } from './persistence/db';
import { layerMaskIds } from './layer-types/definition';
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
let engine: typeof import('./instance')['engine'];
beforeAll(async () => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('Path2D', Path2D);
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

function paintRaster(id: string, x: number, y: number, w: number, h: number, color: string): void {
  const layer = engine.layerById(id);
  if (layer?.type !== 'raster') throw new Error('Raster expected');
  layer.runtime.surface.paint({x, y, w, h}, ctx => {ctx.fillStyle = color; ctx.fillRect(x, y, w, h);});
}

function pixel(layerId: string, x: number, y: number): number[] {
  return [...engine.getLayerCanvas(layerId)!.getContext('2d')!.getImageData(x, y, 1, 1).data];
}

describe('canvas history and new project', () => {
  it('edits bin assets with isolated history and preserves their current contents across page registration Undo and Redo', async () => {
    await engine.newProject();
    engine.addShapeLayer({kind: 'rect', x: 10, y: 10, width: 20, height: 20, color: '#ff0000', strokeWidth: 1, paintMode: 'fill-inside'});
    const id = engine.getActiveLayerId();
    await engine.bins.register(id);
    const bin = engine.bins.items[0];
    const pageHistory = engine.history.current.id;
    expect(bin.layers.every(layer => layer.common.parameterLink?.source.document.kind !== 'page')).toBe(true);
    await engine.bins.open(bin.id);
    expect(engine.documentKey).toEqual({kind: 'bin-item', id: bin.id});
    const before = structuredClone(engine.getShape(id)!);
    engine.commitLayerProps(id, {state: {shape: before}}, {state: {shape: {...before, color: '#0000ff'}}}, '素材色');
    await engine.bins.returnToPage();
    expect(engine.history.current.id).toBe(pageHistory);
    expect(engine.getShape(id)?.color).toBe('#0000ff');
    await engine.undo();
    expect(engine.getShape(id)?.color).toBe('#ff0000');
    expect(engine.bins.items).toHaveLength(1);
    await engine.redo();
    expect(engine.getShape(id)?.color).toBe('#0000ff');
    await engine.bins.open(bin.id);
    await engine.undo();
    expect(engine.getShape(id)?.color).toBe('#ff0000');
    await engine.bins.returnToPage();
    expect(engine.history.current.id).toBe(pageHistory);
    await engine.newProject();
  });

  it('retains distant positive and negative raster tiles through page resize, save and Undo without allocating the gap', async () => {
    await engine.newProject();
    const layer = engine.activeRaster()!;
    engine.captureBefore(layer);
    paintRaster(layer.id, -1000000, -1000000, 2, 2, '#ff0000');
    paintRaster(layer.id, 1000000, 1000000, 2, 2, '#00ff00');
    engine.commitRasterEdit(layer, {minX: -1000000, minY: -1000000, maxX: 1000002, maxY: 1000002}, '遠距離描画');
    await awaitHistoryReady();
    expect(layer.runtime.surface.tileCount).toBe(2);
    const op = internalHistory().current.op;
    expect(op?.kind).toBe('raster');
    if (op?.kind === 'raster') expect(op.tiles).toHaveLength(2);
    const encoded = await layer.runtime.surface.encode();
    const {RasterSurface} = await import('./raster/RasterSurface');
    const restored = await RasterSurface.decode(encoded);
    expect(restored.tileCount).toBe(2);
    expect([...restored.imageData({x: -1000000, y: -1000000, w: 1, h: 1}).data]).toEqual([255, 0, 0, 255]);
    await engine.undo();
    expect(layer.runtime.surface.tileCount).toBe(0);
    await engine.redo();
    expect(layer.runtime.surface.tileCount).toBe(2);
    await engine.newProject();
  });

  it('keeps current cross-page source values when a consumer-only move is undone', async () => {
    await engine.newProject();
    const sourcePage=engine.pages.activePageId;
    engine.addShapeLayer({kind:'rect',x:10,y:10,width:20,height:20,strokeWidth:1,color:'#f00',paintMode:'fill-inside'});
    const sourceId=engine.getActiveLayerId();
    await engine.pages.addPage();const targetPage=engine.pages.pageOrder.find(id=>id!==sourcePage)!;
    await engine.pages.switchPage(targetPage);
    engine.addShapeLayer({kind:'rect',x:10,y:10,width:20,height:20,strokeWidth:1,color:'#f00',paintMode:'fill-inside'});
    const targetId=engine.getActiveLayerId();
    engine.links.createPasteLink(targetId,{document: {kind: 'page' as const, id: sourcePage}, layerId:sourceId});
    const before=structuredClone(engine.layerById(targetId)!.state);
    const after=structuredClone(before);
    if(!('shape' in after) || after.shape.kind!=='rect') throw new Error();
    after.shape.x=50 * 25.4 / engine.getPageSpec().ppi;
    engine.commitLayerProps(targetId,{state:before},{state:after},'参照側の移動');
    await engine.pages.switchPage(sourcePage);
    const oldSource=structuredClone(engine.layerById(sourceId)!.state);
    const newSource=structuredClone(oldSource);
    if(!('shape' in newSource)) throw new Error();
    newSource.shape.color='#00f';
    engine.commitLayerProps(sourceId,{state:oldSource},{state:newSource},'リンク元の色');
    await engine.pages.switchPage(targetPage);
    expect(engine.getShape(targetId)).toMatchObject({x:50,color:'#00f'});
    await engine.undo();
    expect(engine.getShape(targetId)).toMatchObject({x:10,color:'#00f'});
    await engine.redo();
    expect(engine.getShape(targetId)).toMatchObject({x:50,color:'#00f'});
  });

  it('propagates a canvas scale to editable shapes, effect widths, and conjugated operators in one Undo', async () => {
    await engine.newProject();engine.addCanvasLayer();const canvasId=engine.getActiveLayerId();
    engine.addShapeLayer({kind:'rect',x:10,y:10,width:20,height:20,strokeWidth:1,color:'#f00',paintMode:'fill-inside'});
    const shapeId=engine.getActiveLayerId();
    engine.addOutlineLayer();const outlineId=engine.getActiveLayerId();
    engine.addTransformLayer();const transformId=engine.getActiveLayerId();
    engine.commitLayerProps(transformId,{state:{matrix:[1,0,0,0,1,0,0,0,1]}},{state:{matrix:[1,0,10,0,1,0,0,0,1]}},'移動');
    const width=(engine.layerById(outlineId)!.state as {outline:{widthMm:number}}).outline.widthMm;
    engine.setActiveLayer(canvasId);
    const before=internalHistory().current.id;
    const entries=engine.selectedObjectsInRect({minX:0,minY:0,maxX:1000,maxY:1000});
    const source=[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}];
    engine.previewObjectGroup(entries,source,source.map(p=>({x:p.x*2,y:p.y*2})));
    engine.commitObjectGroup(entries);
    expect(engine.getShape(shapeId)?.strokeWidth).toBe(2);
    expect((engine.layerById(outlineId)!.state as {outline:{widthMm:number}}).outline.widthMm).toBe(width*2);
    expect((engine.layerById(transformId)!.state as {matrix:readonly number[]}).matrix[2]).toBeCloseTo(20);
    expect(engine.getActiveLayerId()).toBe(canvasId);
    await engine.undo();
    expect(internalHistory().current.id).toBe(before);
    expect(engine.getShape(shapeId)?.strokeWidth).toBe(1);
    expect((engine.layerById(transformId)!.state as {matrix:readonly number[]}).matrix[2]).toBe(10);
  });

  it('creates a terminal transform only on preview, cancels it cleanly, and restores canvas selection on Redo', async () => {
    await engine.newProject();engine.addCanvasLayer();const canvasId=engine.getActiveLayerId();
    engine.commitLayerProps(canvasId,{state:{propagateTransforms:true}},{state:{propagateTransforms:false}},'伝播');
    engine.addShapeLayer({kind:'rect',x:10,y:10,width:20,height:20,strokeWidth:1,color:'#f00',paintMode:'fill-inside'});
    const shapeId=engine.getActiveLayerId(),shape=structuredClone(engine.getShape(shapeId));
    engine.setActiveLayer(canvasId);
    const count=engine.allLayers().length;
    let entries=engine.selectedObjectsInRect({minX:0,minY:0,maxX:100,maxY:100});
    expect(engine.allLayers()).toHaveLength(count);
    const source=[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}];
    const target=source.map(p=>({x:p.x+15,y:p.y+20}));
    engine.previewObjectGroup(entries,source,target);
    expect(engine.allLayers()).toHaveLength(count+1);
    engine.restoreObjectGroup(entries);
    expect(engine.allLayers()).toHaveLength(count);
    entries=engine.selectedObjectsInRect({minX:0,minY:0,maxX:100,maxY:100});
    engine.previewObjectGroup(entries,source,target);engine.commitObjectGroup(entries);
    expect(engine.getShape(shapeId)).toEqual(shape);
    const terminal=layerChildren(engine.layerById(canvasId)).at(-1)!;
    expect(engine.layerById(terminal)?.type).toBe('transform');
    await engine.undo();expect(engine.layerById(terminal)).toBeNull();
    await engine.redo();expect(engine.layerById(terminal)?.type).toBe('transform');
    expect(engine.getActiveLayerId()).toBe(canvasId);
    expect(engine.getShape(shapeId)).toEqual(shape);
  });

  it('groups siblings without a render node, restores order and grouping with one Undo, and persists groups', async () => {
    await engine.newProject();
    const first=engine.getActiveLayerId();
    engine.addRasterLayer();const middle=engine.getActiveLayerId();
    engine.addRasterLayer();const last=engine.getActiveLayerId();
    engine.layerService.selectMembers([first,last]);
    engine.stacks.create();
    expect(engine.getRootLayerIds()).toEqual([first,last,middle]);
    expect(engine.allLayers()).toHaveLength(3);
    expect(engine.stacks.snapshot()[0].memberIds).toEqual([first,last]);
    await engine.undo();
    expect(engine.getRootLayerIds()).toEqual([first,middle,last]);
    expect(engine.stacks.snapshot()).toEqual([]);
    await engine.redo();
    const groups=engine.stacks.snapshot();
    await engine.flushSavePublic();
    const {page}=await loadActivePersisted();
    expect(page?.layerStacks).toEqual(groups);
    await engine.restoreSavedPagePublic(page!);
    expect(engine.stacks.snapshot()).toEqual(groups);
    await engine.undo();
    expect(engine.stacks.snapshot()).toEqual([]);
    expect(engine.getRootLayerIds()).toEqual([first,middle,last]);
  });

  it('dissolves a two-member stack on deletion and restores membership when deletion is undone', async () => {
    await engine.newProject();const first=engine.getActiveLayerId();
    engine.addRasterLayer();const second=engine.getActiveLayerId();
    engine.layerService.selectMembers([first,second]);engine.stacks.create();
    const groups=engine.stacks.snapshot();
    engine.removeLayer(second);
    expect(engine.stacks.snapshot()).toEqual([]);
    await engine.undo();
    expect(engine.stacks.snapshot()).toEqual(groups);
    expect(engine.layerById(second)).not.toBeNull();
  });

  it('creates a panel subtree with a deferred raster and restores it in one history step', async () => {
    await engine.newProject();
    const shape = {
      kind: 'polygon' as const, cx: 80, cy: 60,
      points: [{ x: -50, y: -30 }, { x: 50, y: -30 }, { x: 50, y: 30 }, { x: -50, y: 30 }],
      rotation: 0, color: '#ffffff', strokeWidth: 0, paintMode: 'fill-inside' as const,
      strokeJoin: 'miter' as const, cornerRadius: 0,
    };
    engine.addPanelFrame(shape, { outlineColor: '#112233', outlineWidthMm: 2 });
    const panel = useStore.getState().layers.find(layer => layer.name === 'コマ')!;
    const [maskId, rasterId, clipId, outlineId] = panel.childIds;
    const clip = useStore.getState().layers.find(layer => layer.id === clipId)!;
    const outline = useStore.getState().layers.find(layer => layer.id === outlineId)!;
    expect(useStore.getState().activeLayerId).toBe(rasterId);
    expect(panel.type).toBe('canvas');
    expect(clip.state).toEqual({ maskLayerIds: [maskId] });
    expect(outline.state).toMatchObject({ outline: { color: '#112233', widthMm: 2, cornerStyle: 'sharp' } });
    const internal = engine.layerById(rasterId);
    expect(internal?.type).toBe('raster');
    if (internal?.type === 'raster') expect(internal.runtime.surface.tileCount).toBe(0);
    expect(internalHistory().current.op?.kind).toBe('layerReplace');
    await engine.undo();
    expect(useStore.getState().layers.some(layer => layer.id === panel.id)).toBe(false);
    await engine.redo();
    expect(useStore.getState().layers.some(layer => layer.id === panel.id)).toBe(true);
  });

  it('creates a bubble in body-tail-outline-text order with a linked tail', async () => {
    await engine.newProject();
    const body = { kind: 'ellipse' as const, cx: 100, cy: 100, rx: 60, ry: 40, rotation: 0, color: '#fffefe', strokeWidth: 0, paintMode: 'fill-inside' as const };
    const tail = { kind: 'bubble-tail' as const, style: 'rounds' as const, start: { x: 60, y: 125 }, control: { x: 40, y: 150 }, tip: { x: 20, y: 180 }, width: 12, circleCount: 4, spacingDecay: .35, color: '#fffefe', strokeWidth: 0, strokeJoin: 'round' as const };
    engine.addSpeechBubble(body, tail, {
      outlineColor: '#000000', outlineWidthMm: 1, textColor: '#123456', fontId: 'serif', fontSizePt: 12,
      textFrame: { x: 58, y: 72, w: 84, h: 56 },
    });
    const bubble = useStore.getState().layers.find(layer => layer.name === '吹き出し')!;
    const children = bubble.childIds.map(id => useStore.getState().layers.find(layer => layer.id === id)!);
    expect(children.map(layer => layer.name)).toEqual(['本体', 'しっぽ', '吹き出し枠', '文字']);
    expect(children[1].parameterLink).toMatchObject({ source: { layerId: children[0].id }, linkedParameterIds: ['appearance.color'] });
    expect(children[2].state).toMatchObject({ outline: { cornerStyle: 'round' } });
    expect(children[3].state).toMatchObject({ text: { direction: 'vertical', horizontalAlign: 'left', verticalAlign: 'top', lineHeight: 1.5, width: 84 * 25.4 / engine.getPageSpec().ppi, height: expect.closeTo(56 * 25.4 / engine.getPageSpec().ppi) } });
    expect(useStore.getState().textEditingId).toBe(children[3].id);
    await engine.undo();
    expect(useStore.getState().layers.some(layer => layer.id === bubble.id)).toBe(false);
    await engine.redo();
    expect(useStore.getState().layers.some(layer => layer.id === bubble.id)).toBe(true);
  });

  it('converts a rotated rectangle to an editable polygon without changing its identity or sibling ownership', async () => {
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
    expect(useStore.getState().layers.find(layer => layer.id === id)).toMatchObject({ name: '多角形', childIds: [] });
    expect(converted?.kind === 'polygon' ? converted.points : []).toHaveLength(4);
    await engine.undo();
    expect(engine.getShape(id)).toMatchObject({ kind: 'rect', rotation: Math.PI / 6 });
    expect(useStore.getState().layers.find(layer => layer.id === id)).toMatchObject({ name: '四角形', childIds: [] });
    await engine.redo();
    expect(engine.getShape(id)?.kind).toBe('polygon');
  });

  it('splits a rectangle as one persistent action without duplicating siblings', async () => {
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
    expect(rasters).toHaveLength(2);
    expect(shapes.map(layer => layer.type === 'shape' && layer.state.shape)).toEqual(expect.arrayContaining([
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
    expect(useStore.getState().layers.filter(layer => layer.type === 'raster')).toHaveLength(2);
    await (engine as unknown as { flushSave(): Promise<void> }).flushSave();
    const { page } = await loadActivePersisted();
    expect(page?.history.nodes.some(node => node.op?.kind === 'layerReplace')).toBe(true);
  });

  it('rejects reparenting a shape under another ordinary layer', async () => {
    await engine.newProject();
    engine.addShapeLayer({ kind: 'rect', x: 0, y: 0, width: 100, height: 100, color: '#000', strokeWidth: 2, paintMode: 'stroke' });
    const parentId = useStore.getState().activeLayerId;
    engine.addShapeLayer({ kind: 'rect', x: 20, y: 20, width: 40, height: 40, color: '#000', strokeWidth: 2, paintMode: 'stroke' });
    const childId = useStore.getState().activeLayerId;
    const historyBefore = useStore.getState().historyCount;
    engine.moveLayerAsTopChild(childId, parentId);
    expect(useStore.getState().layers.find(layer => layer.id === childId)?.parentId).toBeNull();
    expect(useStore.getState().historyCount).toBe(historyBefore);
  });

  it('fills only the primary raster using mixed selected layers as the visible boundary', async () => {
    await engine.newProject();
    const rasterId = useStore.getState().activeLayerId;
    engine.addShapeLayer({ kind: 'rect', x: 10, y: 10, width: 40, height: 40, rotation: 0, color: '#000000', strokeWidth: 4, paintMode: 'stroke' });
    const shapeId = useStore.getState().activeLayerId;
    const originalShape = engine.getShape(shapeId);
    engine.setActiveLayer(rasterId);
    engine.beginMultiSelect(shapeId);
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
    engine.updateSelectedShapes(shape => shape.kind === 'rect' ? { ...shape, width: 120 * 25.4 / engine.getPageSpec().ppi } : shape);
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
    const text = { ...newText(20, 20, '#222222'), content: 'ab', ranges: [{ start: 0, end: 1, fontId: 'serif', color: '#333333', sizeMm: 8 }] };
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
    engine.captureBefore(engine.activeRaster()!);
    paintRaster(id, 1200, 900, 20, 20, '#ff0000');
    engine.commitRasterEdit(engine.activeRaster()!, { minX: 1200, minY: 900, maxX: 1220, maxY: 920 }, '描画');
    engine.commitLayerProps(id, { opacity: 1 }, { opacity: .6 }, 'opacity');
    const smaller = { widthMm: 800 * 25.4 / 300, heightMm: 600 * 25.4 / 300, ppi: 300 };
    await engine.resizePage(smaller);
    expect(engine.getLayerCanvas(id)!.width).toBe(800);
    await (engine as unknown as { flushSave(): Promise<void> }).flushSave();
    const { page: persisted } = await loadActivePersisted();
    expect(persisted?.history?.nodes.some(n => n.op?.kind === 'pageChange')).toBe(true);
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
    paintRaster(raster, 10, 10, 20, 20, '#00ff00');
    engine.addShapeLayer({ kind: 'line', x1: 10, y1: 20, x2: 100, y2: 120, color: '#000000', strokeWidth: 3 });
    const shapeId = useStore.getState().activeLayerId;
    const text: TextParams = { ...newText(30, 40, '#000000', 200, 100), content: '文字' };
    engine.addTextLayer(text);
    const textId = useStore.getState().activeLayerId;
    await engine.resizePage({ ...useStore.getState().pageSpec, ppi: 600 });
    expect(engine.getLayerCanvas(raster)!.width).toBe(1600);
    expect([...engine.getLayerCanvas(raster)!.getContext('2d')!.getImageData(30, 30, 1, 1).data]).toEqual([0, 255, 0, 255]);
    expect(engine.getShape(shapeId)).toMatchObject({ x1: 20, y1: 40, strokeWidth: 6 });
    expect(engine.getText(textId)).toMatchObject({ x: 60, y: 80, width: 400, height: 200, style: { sizeMm: 12 * 25.4 / 72 } });
    await engine.undo();
    expect(engine.getText(textId)).toEqual(text);
    await engine.redo();
    expect(useStore.getState().pageSpec.ppi).toBe(600);
  });
  it('new project clears project data atomically and rejects delayed reference writes', async () => {
    const oldEpoch = referenceEpoch();
    const reference = { blob: new Blob(['image']), name: 'reference', naturalWidth: 1, naturalHeight: 1, x: 0, y: 0, width: 100, rotation: 0, opacity: 1, locked: false };
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
    expect(useStore.getState().layers.some(layer => layer.id === id)).toBe(true);
    expect(engine.finishTextEditing()).toBe(true);
    expect(useStore.getState().layers.some(layer => layer.id === id)).toBe(false);
  });

  it('exits multi-select when the selection shrinks to one layer and batches opacity preview history', async () => {
    await engine.newProject();
    const first = useStore.getState().activeLayerId;
    engine.addRasterLayer();
    const second = useStore.getState().activeLayerId;
    engine.beginMultiSelect(first);
    expect(useStore.getState().selectedLayerIds[0]).toBe(second);
    const before = Object.fromEntries(useStore.getState().selectedLayerIds.map(id => [id, useStore.getState().layers.find(layer => layer.id === id)!.opacity]));
    engine.previewSelectedLayerProps({ opacity: .35 });
    engine.commitSelectedLayerOpacity(before, .35);
    expect(useStore.getState().layers.filter(layer => [first, second].includes(layer.id)).map(layer => layer.opacity)).toEqual([.35, .35]);
    await engine.undo();
    expect(useStore.getState().layers.filter(layer => [first, second].includes(layer.id)).map(layer => layer.opacity)).toEqual([1, 1]);
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

  it('selects a canvas without selecting descendants and confines multi-selection to one scope', async () => {
    await engine.newProject();
    engine.addCanvasLayer();
    const canvasId = useStore.getState().activeLayerId;
    engine.addRasterLayer();
    const childId = useStore.getState().activeLayerId;
    expect(useStore.getState().layers.find(layer => layer.id === childId)?.parentId).toBe(canvasId);
    engine.setActiveLayer(canvasId);
    expect(useStore.getState().selectedLayerIds).toEqual([canvasId]);
    engine.beginMultiSelect(childId);
    expect(useStore.getState().selectedLayerIds).toEqual([childId]);
  });

  it('stores raster merges as tiles-v1 across undo, redo and reload', async () => {
    await engine.newProject();
    const lowerId = useStore.getState().activeLayerId;
    paintRaster(lowerId, 0, 0, 100, 100, '#ff0000');
    engine.addRasterLayer();
    const upperId = useStore.getState().activeLayerId;
    paintRaster(upperId, 10, 10, 20, 20, '#0000ff');
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

  it('merges drawable and effect layers as tiles-v1', async () => {
    const verify = async (type: 'shape' | 'text' | 'adjust' | 'outline' | 'clip' | 'image', add: () => void) => {
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
    paintRaster(targetId, 0, 0, 1, 1, '#ff0000');
    engine.commitLayerProps(targetId, { opacity: 1 }, { opacity: .5 }, '不透明度');
    engine.addAdjustLayer();
    const effectId = useStore.getState().activeLayerId;
    engine.commitLayerProps(
      effectId,
      { state: { params: { brightness: 100, contrast: 100, hue: 0, saturation: 100 } } },
      { state: { params: { brightness: 0, contrast: 100, hue: 0, saturation: 100 } } },
      '明度',
    );
    await engine.mergeLayerDown(effectId);
    await awaitHistoryReady();
    expect(useStore.getState().layers.find(layer => layer.id === targetId)?.opacity).toBe(1);
    expect(pixel(targetId, 0, 0)[3]).toBeGreaterThanOrEqual(127);
    expect(pixel(targetId, 0, 0)[3]).toBeLessThanOrEqual(128);
    await engine.undo();
    expect(useStore.getState().layers.find(layer => layer.id === targetId)?.opacity).toBe(.5);
    expect(pixel(targetId, 0, 0)).toEqual([255, 0, 0, 255]);
    await engine.redo();
    expect(useStore.getState().layers.find(layer => layer.id === targetId)?.opacity).toBe(1);
  });

  it('allows effect merge only when one raster precedes it in the same scope', async () => {
    await engine.newProject();
    engine.addCanvasLayer();
    engine.addRasterLayer();
    engine.addClipLayer();
    const effectId = useStore.getState().activeLayerId;
    expect(useStore.getState().layers.find(layer => layer.id === effectId)?.canMergeDown).toBe(true);
    engine.addRasterLayer();
    const extraId = useStore.getState().activeLayerId;
    const effect = useStore.getState().layers.find(layer => layer.id === effectId)!;
    engine.moveLayer(extraId, {parentId: effect.parentId, index: 0});
    expect(useStore.getState().layers.find(layer => layer.id === effectId)?.canMergeDown).toBe(false);
  });

  it('retains authored mask references through deletion, undo and redo', async () => {
    await engine.newProject();
    const maskId = useStore.getState().activeLayerId;
    engine.addClipLayer();
    const clipId = useStore.getState().activeLayerId;
    engine.commitLayerProps(clipId, { state: { maskLayerIds: [] } }, { state: { maskLayerIds: [maskId] } }, 'マスク');
    engine.addRasterLayer();
    engine.removeLayer(maskId);
    expect(layerMaskIds(useStore.getState().layers.find(layer => layer.id === clipId)?.state)).toEqual([maskId]);
    await engine.undo();
    expect(useStore.getState().layers.some(layer => layer.id === maskId)).toBe(true);
    expect(layerMaskIds(useStore.getState().layers.find(layer => layer.id === clipId)?.state)).toEqual([maskId]);
    await engine.redo();
    expect(layerMaskIds(useStore.getState().layers.find(layer => layer.id === clipId)?.state)).toEqual([maskId]);
  });
});

describe('shape snap, constraints, and persistence', () => {
  const pt = (x: number, y: number) => ({ x, y, pressure: 1 });
  function shapeEdit() {
    return (engine as unknown as { shapeEdit: { snapGuides(): { x: number | null; y: number | null } } }).shapeEdit;
  }
  function layerSnap(id: string) {
    return (engine as unknown as { layerService: { shapeById(id: string): { state: { snapEnabled: boolean } } | null } }).layerService.shapeById(id)?.state.snapEnabled;
  }

  it('creates shapes with snap on and keeps the setting through undo, save, and copy', async () => {
    await engine.newProject();
    engine.addShapeLayer({ kind: 'rect', x: 40, y: 40, width: 20, height: 20, color: '#000', strokeWidth: 2, paintMode: 'stroke' });
    const id = useStore.getState().activeLayerId;
    expect(layerSnap(id)).toBe(true);
    engine.commitLayerProps(id, { state: { snapEnabled: true } }, { state: { snapEnabled: false } }, 'スナップを変更');
    expect(layerSnap(id)).toBe(false);
    await engine.undo();
    expect(layerSnap(id)).toBe(true);
    await engine.redo();
    expect(layerSnap(id)).toBe(false);
    await engine.copyLayers(id);
    await engine.pasteLayers();
    const shapes = useStore.getState().layers.filter(layer => layer.type === 'shape');
    expect(shapes.every(layer => layer.type === 'shape' && layer.state.snapEnabled === false)).toBe(true);
    await (engine as unknown as { flushSave(): Promise<void> }).flushSave();
    const { page } = await loadActivePersisted();
    expect(page?.layers.filter(layer => layer.type === 'shape').every(layer => (layer.state as { snapEnabled?: boolean }).snapEnabled === false)).toBe(true);
  });

  it('snaps moves to canvas lines, skips hidden and self, and stays free when disabled', async () => {
    await engine.newProject();
    engine.addShapeLayer({ kind: 'rect', x: 50, y: 10, width: 8, height: 8, color: '#000', strokeWidth: 1, paintMode: 'stroke' });
    const hiddenId = useStore.getState().activeLayerId;
    engine.commitLayerProps(hiddenId, { visible: true }, { visible: false }, '表示切替');
    engine.addShapeLayer({ kind: 'rect', x: 44, y: 200, width: 40, height: 40, color: '#000', strokeWidth: 1, paintMode: 'stroke' });
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
    engine.addShapeLayer({ kind: 'rect', x: 5, y: 80, width: 40, height: 40, color: '#000', strokeWidth: 1, paintMode: 'stroke' });
    const nearId = useStore.getState().activeLayerId;
    engine.commitLayerProps(nearId, { state: { snapEnabled: true } }, { state: { snapEnabled: false } }, 'スナップを変更');
    engine.beginShapeEdit(pt(25, 100));
    engine.updateShapeEdit(pt(28, 100));
    expect(engine.getShape(nearId)).toMatchObject({ x: 8 });
    expect(shapeEdit().snapGuides()).toEqual({ x: null, y: null });
    engine.cancelShapeEdit();
    engine.commitLayerProps(nearId, { state: { snapEnabled: false } }, { state: { snapEnabled: true } }, 'スナップを変更');
    engine.beginShapeEdit(pt(25, 100));
    engine.updateShapeEdit(pt(25, 100));
    expect(engine.getShape(nearId)).toMatchObject({ x: 0 });
    expect(shapeEdit().snapGuides().x).toBe(0);
    engine.cancelShapeEdit();
  });

  it('snaps rotate-handle angles near 90 degrees and records one history entry', async () => {
    await engine.newProject();
    engine.addShapeLayer({ kind: 'rect', x: 0, y: 0, width: 100, height: 100, rotation: 0, color: '#000', strokeWidth: 1, paintMode: 'stroke' });
    const id = useStore.getState().activeLayerId;
    const historyBefore = useStore.getState().historyCount;
    expect(engine.beginShapeEdit(pt(50, -28))).toBe(true);
    engine.updateShapeEdit(pt(150, 50));
    expect(engine.getShape(id)).toMatchObject({ rotation: Math.PI / 2 });
    engine.finishShapeEdit(pt(150, 50));
    expect(useStore.getState().historyCount).toBe(historyBefore + 1);

    engine.commitLayerProps(id, { state: { snapEnabled: true } }, { state: { snapEnabled: false } }, 'スナップを変更');
    const angle = -6 * Math.PI / 180;
    engine.beginShapeEdit(pt(50, -28));
    engine.updateShapeEdit(pt(50 + Math.cos(angle) * 100, 50 + Math.sin(angle) * 100));
    const free = engine.getShape(id);
    expect(free && 'rotation' in free ? free.rotation : 0).not.toBeCloseTo(Math.PI / 2, 5);
    engine.cancelShapeEdit();
  });

  it('does not apply snap during lasso object transforms', async () => {
    await engine.newProject();
    engine.addShapeLayer({ kind: 'rect', x: 5, y: 80, width: 20, height: 20, color: '#000', strokeWidth: 1, paintMode: 'stroke' });
    const id = useStore.getState().activeLayerId;
    const entries = engine.selectedObjectsInRect({ minX: 0, minY: 0, maxX: 40, maxY: 120 });
    expect(entries.some(entry => entry.id === id)).toBe(true);
    engine.previewObjectGroup(
      entries,
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      [{ x: 1, y: 0 }, { x: 11, y: 0 }, { x: 11, y: 10 }, { x: 1, y: 10 }],
    );
    expect(engine.getShape(id)).toMatchObject({ x: expect.closeTo(6), y: 80 });
  });

  it('constrains polygon vertices along edges from Shift or the GUI toggle', async () => {
    await engine.newProject();
    engine.addShapeLayer({
      kind: 'polygon', cx: 0, cy: 0, rotation: 0, color: '#000', strokeWidth: 1, paintMode: 'stroke',
      points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 40 }],
    });
    const id = useStore.getState().activeLayerId;
    expect(engine.beginShapeEdit(pt(0, 0))).toBe(true);
    engine.updateShapeEdit(pt(10, 2), { shiftKey: true } as PointerEvent);
    expect(engine.getShape(id)).toEqual(expect.objectContaining({
      kind: 'polygon',
      points: [expect.objectContaining({ x: 10, y: 0 }), expect.anything(), expect.anything()],
    }));
    engine.cancelShapeEdit();
    engine.beginShapeEdit(pt(0, 0));
    engine.setShapeHandleEdgeConstrained(true);
    engine.updateShapeEdit(pt(2, 10));
    expect(engine.getShape(id)).toEqual(expect.objectContaining({
      kind: 'polygon',
      points: [expect.objectContaining({ x: 0, y: 10 }), expect.anything(), expect.anything()],
    }));
    engine.cancelShapeEdit();
    const raster = useStore.getState().layers.find(layer => layer.type === 'raster')!.id;
    engine.setActiveLayer(raster);
    expect(useStore.getState().shapeHandleSelected).toBe(false);
    expect(useStore.getState().shapeHandleEdgeConstrained).toBe(false);
  });

  it('snaps a polygon vertex to another visible polygon vertex and honors the snap switch', async () => {
    await engine.newProject();
    engine.addShapeLayer({
      kind: 'polygon', cx: 0, cy: 0, rotation: 0, color: '#000', strokeWidth: 1, paintMode: 'stroke',
      points: [{ x: 100, y: 100 }, { x: 140, y: 100 }, { x: 100, y: 140 }],
    });
    engine.addShapeLayer({
      kind: 'polygon', cx: 0, cy: 0, rotation: 0, color: '#000', strokeWidth: 1, paintMode: 'stroke',
      points: [{ x: 20, y: 20 }, { x: 60, y: 20 }, { x: 20, y: 60 }],
    });
    const id = useStore.getState().activeLayerId;
    engine.beginShapeEdit(pt(60, 20));
    engine.updateShapeEdit(pt(96, 98));
    expect(engine.getShape(id)).toEqual(expect.objectContaining({
      kind: 'polygon',
      points: [expect.anything(), expect.objectContaining({ x: 100, y: 100 }), expect.anything()],
    }));
    engine.cancelShapeEdit();
    engine.commitLayerProps(id, { state: { snapEnabled: true } }, { state: { snapEnabled: false } }, 'スナップを変更');
    engine.beginShapeEdit(pt(60, 20));
    engine.updateShapeEdit(pt(96, 98));
    expect(engine.getShape(id)).toEqual(expect.objectContaining({
      kind: 'polygon',
      points: [expect.anything(), expect.objectContaining({ x: expect.closeTo(96), y: expect.closeTo(98) }), expect.anything()],
    }));
    engine.cancelShapeEdit();
  });

  it('snaps polygon vertices to vertex axis lines and the same guides used by shape movement', async () => {
    await engine.newProject();
    engine.addShapeLayer({ kind: 'rect', x: 200, y: 250, width: 40, height: 40, color: '#000', strokeWidth: 1, paintMode: 'stroke' });
    engine.addShapeLayer({
      kind: 'polygon', cx: 0, cy: 0, rotation: 0, color: '#000', strokeWidth: 1, paintMode: 'stroke',
      points: [{ x: 100, y: 100 }, { x: 140, y: 100 }, { x: 100, y: 140 }],
    });
    const id = useStore.getState().activeLayerId;
    engine.beginShapeEdit(pt(140, 100));
    engine.updateShapeEdit(pt(204, 137));
    expect(engine.getShape(id)).toEqual(expect.objectContaining({
      kind: 'polygon',
      points: [expect.anything(), expect.objectContaining({ x: expect.closeTo(200), y: expect.closeTo(140) }), expect.anything()],
    }));
    expect(shapeEdit().snapGuides()).toEqual({ x: expect.closeTo(200), y: expect.closeTo(140) });
    engine.cancelShapeEdit();
  });

  it('merges a dragged polygon vertex when it snaps onto an adjacent vertex', async () => {
    await engine.newProject();
    engine.addShapeLayer({
      kind: 'polygon', cx: 0, cy: 0, rotation: 0, color: '#000', strokeWidth: 1, paintMode: 'stroke',
      points: [{ x: 20, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 60 }, { x: 20, y: 60 }],
    });
    const id = useStore.getState().activeLayerId;
    engine.beginShapeEdit(pt(60, 20));
    engine.updateShapeEdit(pt(23, 22));
    engine.finishShapeEdit(pt(23, 22));
    const shape = engine.getShape(id);
    expect(shape?.kind).toBe('polygon');
    expect(shape && shape.kind === 'polygon' ? shape.points : []).toHaveLength(3);
    await engine.undo();
    const restored = engine.getShape(id);
    expect(restored && restored.kind === 'polygon' ? restored.points : []).toHaveLength(4);
  });

  it('constrains rectangle and ellipse corner transforms along their original edges', async () => {
    await engine.newProject();
    engine.addShapeLayer({ kind: 'rect', x: 20, y: 20, width: 40, height: 30, rotation: 0, color: '#000', strokeWidth: 1, paintMode: 'stroke' });
    const rectId = useStore.getState().activeLayerId;
    engine.beginShapeEdit(pt(20, 20));
    engine.setShapeHandleEdgeConstrained(true);
    engine.updateShapeEdit(pt(35, 23));
    expect(engine.getShape(rectId)).toMatchObject({ kind: 'rect', x: expect.closeTo(35), y: expect.closeTo(20), width: expect.closeTo(25), height: expect.closeTo(30) });
    engine.finishShapeEdit(pt(35, 23));

    engine.addShapeLayer({ kind: 'ellipse', cx: 100, cy: 100, rx: 20, ry: 10, rotation: 0, color: '#000', strokeWidth: 1, paintMode: 'stroke' });
    const ellipseId = useStore.getState().activeLayerId;
    engine.beginShapeEdit(pt(80, 90));
    engine.setShapeHandleEdgeConstrained(true);
    engine.updateShapeEdit(pt(83, 82));
    expect(engine.getShape(ellipseId)).toMatchObject({ kind: 'ellipse', cx: 100, cy: 96, rx: 20, ry: 14 });
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
    const existing = useStore.getState().tools.find(tool => tool.kind === kind);
    if (existing) engine.selectToolInstance(existing.id);
    else engine.addToolInstance(kind);
  }

  it('still floats a lassoed raster and commits the moved pixels', async () => {
    await engine.newProject();
    const rasterId = useStore.getState().activeLayerId;
    paintRaster(rasterId, 10, 10, 20, 20, '#ff0000');
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
    paintRaster(rasterId, 10, 10, 20, 20, '#ff0000');
    engine.addShapeLayer({ kind: 'rect', x: 40, y: 40, width: 20, height: 20, color: '#00ff00', strokeWidth: 1, paintMode: 'fill-inside' });
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


describe('raster physical input coordinates', () => {
  it('inverse maps the complete brush through an operator and native PPI and preserves one undo', async () => {
    await engine.newProject();
    const raster = engine.activeRaster()!;
    const ppi = engine.getPageSpec().ppi;
    raster.runtime.surface.restore({...raster.runtime.surface.snapshot(), intrinsicPpi: ppi / 2});
    engine.layerService.addTransformLayer();
    const operator = engine.layerById(engine.layerService.activeLayerId)!;
    if (operator.type !== 'transform') throw new Error('missing transform');
    // Native pixel (10, 10) → page pixel (20, 20) → displayed pixel (60, 40).
    operator.state.matrix = [2, 0, 20 * 25.4 / ppi, 0, 2, 0, 0, 0, 1];
    engine.setActiveLayer(raster.id);
    const { PenTool } = await import('../tools/pen/tool');
    const pen = new PenTool(engine);
    pen.onDown({x: 60, y: 40, pressure: 1});
    pen.onUp({x: 60, y: 40, pressure: 1}, {pressure: 1} as PointerEvent);
    await awaitHistoryReady();
    expect(raster.runtime.surface.imageData({x: 10, y: 10, w: 1, h: 1}).data[3]).toBeGreaterThan(0);
    expect(raster.runtime.surface.imageData({x: 60, y: 40, w: 1, h: 1}).data[3]).toBe(0);
    await engine.undo();
    expect(raster.runtime.surface.tileCount).toBe(0);
    await engine.redo();
    expect(raster.runtime.surface.imageData({x: 10, y: 10, w: 1, h: 1}).data[3]).toBeGreaterThan(0);
  });
});


describe('shared raster content', () => {
  it('follows bin drawing until content is edited, and undo relinks without rewinding the bin', async () => {
    await engine.newProject();
    engine.selectToolInstance(useStore.getState().tools.find(tool => tool.kind === 'pen')!.id);
    const id = engine.getActiveLayerId();
    paintRaster(id, 10, 10, 4, 4, '#ff0000');
    await engine.bins.register(id);
    expect(engine.layerById(id)?.parameterLink?.linkedContent).toBe(true);
    const bin = engine.bins.items[0];
    await engine.bins.open(bin.id);
    paintRaster(id, 10, 10, 4, 4, '#0000ff');
    engine.committed();
    expect(pixel(id, 11, 11)[2]).toBe(255);
    await engine.bins.returnToPage();
    await engine.readyToRender();
    expect(engine.layerById(id)?.parameterLink?.linkedContent).toBe(true);
    const {RasterSurface} = await import('./raster/RasterSurface');
    const savedBinSurface = await RasterSurface.decode(engine.bins.items[0].layers[0].content!);
    expect([...savedBinSurface.imageData({x: 11, y: 11, w: 1, h: 1}).data]).toEqual([0, 0, 255, 255]);
    expect(pixel(id, 11, 11)).toEqual([0, 0, 255, 255]);
    await engine.undo();
    expect(pixel(id, 11, 11)).toEqual([255, 0, 0, 255]);
    await engine.redo();
    await engine.readyToRender();
    expect(pixel(id, 11, 11)).toEqual([0, 0, 255, 255]);
    const target = engine.activeRaster()!;
    engine.captureBefore(target);
    paintRaster(id, 20, 20, 4, 4, '#00ff00');
    engine.commitRasterEdit(target, {minX: 20, minY: 20, maxX: 24, maxY: 24}, '参照側へ描画');
    await awaitHistoryReady();
    expect(target.parameterLink?.linkedContent).toBe(false);
    await engine.bins.open(bin.id);
    paintRaster(id, 10, 10, 4, 4, '#ffff00');
    engine.committed();
    await engine.bins.returnToPage();
    await engine.readyToRender();
    expect(pixel(id, 11, 11)).toEqual([0, 0, 255, 255]);
    expect(pixel(id, 21, 21)).toEqual([0, 255, 0, 255]);
    await engine.undo();
    expect(pixel(id, 11, 11)).toEqual([255, 255, 0, 255]);
    expect(pixel(id, 21, 21)[3]).toBe(0);
    await engine.redo();
    expect(pixel(id, 11, 11)).toEqual([0, 0, 255, 255]);
    expect(pixel(id, 21, 21)).toEqual([0, 255, 0, 255]);
    await engine.links.relinkContent(id);
    expect(pixel(id, 11, 11)).toEqual([255, 255, 0, 255]);
    expect(pixel(id, 21, 21)[3]).toBe(0);
    await engine.undo();
    expect(pixel(id, 11, 11)).toEqual([0, 0, 255, 255]);
    expect(pixel(id, 21, 21)).toEqual([0, 255, 0, 255]);
  });
});


describe('PPI ownership', () => {
  it('resamples only page-owned independent content and renders bin content at the same mm size', async () => {
    await engine.newProject();
    engine.selectToolInstance(useStore.getState().tools.find(tool => tool.kind === 'pen')!.id);
    const sharedId = engine.getActiveLayerId(), ppi = engine.getPageSpec().ppi;
    paintRaster(sharedId, 10, 10, 4, 4, '#ff0000');
    await engine.bins.register(sharedId);
    engine.layerService.addRasterLayer();
    const ownedId = engine.getActiveLayerId();
    paintRaster(ownedId, 10, 10, 4, 4, '#0000ff');
    await engine.resizePage({...engine.getPageSpec(), ppi: ppi * 2});
    const shared = engine.layerService.rasterById(sharedId)!;
    const owned = engine.layerService.rasterById(ownedId)!;
    expect(shared.runtime.surface.intrinsicPpi).toBe(ppi);
    expect(owned.runtime.surface.intrinsicPpi).toBe(ppi * 2);
    expect(pixel(sharedId, 22, 22)).toEqual([255, 0, 0, 255]);
    expect(pixel(sharedId, 11, 11)[3]).toBe(0);
    await engine.undo();
    expect(engine.layerService.rasterById(ownedId)!.runtime.surface.intrinsicPpi).toBe(ppi);
    expect(pixel(sharedId, 11, 11)).toEqual([255, 0, 0, 255]);
  });
});


describe('linked canvas structures', () => {
  it('keeps locally edited deleted descendants and follows source reordering around local additions', async () => {
    await engine.newProject();
    engine.selectToolInstance(useStore.getState().tools.find(tool => tool.kind === 'pen')!.id);
    engine.addCanvasLayer(); const canvasId = engine.getActiveLayerId();
    const shape = {kind: 'rect' as const, x: 10, y: 10, width: 20, height: 20, color: '#f00', strokeWidth: 1, paintMode: 'fill-inside' as const};
    engine.addShapeLayer(shape); const first = engine.getActiveLayerId();
    engine.addShapeLayer(shape); const second = engine.getActiveLayerId();
    await engine.bins.register(canvasId); const bin = engine.bins.items[0];
    engine.layerService.renameLayer(first, '独自の子');
    await engine.canvases.flush();
    await engine.bins.open(bin.id);
    engine.removeLayer(first);
    await engine.bins.returnToPage();
    await engine.readyToRender();
    const canvas = engine.layerById(canvasId)!;
    expect(layerChildren(canvas)).toContain(first);
    expect(engine.layerById(first)?.name).toBe('独自の子');
    expect(engine.layerById(first)?.parameterLink).toBeUndefined();
    expect(layerChildren(canvas)).toContain(second);
    engine.setActiveLayer(canvasId); engine.layerService.addRasterLayer();
    const local = engine.getActiveLayerId();
    engine.moveLayer(local, {parentId: canvasId, index: 0});
    await engine.readyToRender();
    expect(layerChildren(canvas)[0]).toBe(local);
    await engine.bins.open(bin.id);
    engine.setActiveLayer(canvasId); engine.addShapeLayer(shape);
    const newSource = engine.getActiveLayerId();
    await engine.bins.returnToPage(); await engine.readyToRender();
    const restored = engine.layerById(canvasId)!;
    expect(layerChildren(restored)[0]).toBe(local);
    expect(layerChildren(restored)).toContain(first);
    expect(layerChildren(restored).some(id => engine.layerById(id)?.parameterLink?.source.layerId === newSource)).toBe(true);
  });

  it('follows bin additions, preserves occurrence IDs, and restores locally suppressed children with Undo', async () => {
    await engine.newProject();
    engine.selectToolInstance(useStore.getState().tools.find(tool => tool.kind === 'pen')!.id);
    engine.addCanvasLayer();
    const canvasId = engine.getActiveLayerId();
    engine.addShapeLayer({kind: 'rect', x: 10, y: 10, width: 20, height: 20, color: '#f00', strokeWidth: 1, paintMode: 'fill-inside'});
    const originalId = engine.getActiveLayerId();
    await engine.bins.register(canvasId);
    const bin = engine.bins.items[0];
    await engine.bins.open(bin.id);
    engine.setActiveLayer(canvasId);
    engine.addShapeLayer({kind: 'rect', x: 40, y: 10, width: 20, height: 20, color: '#00f', strokeWidth: 1, paintMode: 'fill-inside'});
    const addedSourceId = engine.getActiveLayerId();
    await engine.bins.returnToPage();
    await engine.readyToRender();
    const canvas = engine.layerById(canvasId)!;
    expect(layerChildren(canvas)).toHaveLength(2);
    expect(layerChildren(canvas)[0]).toBe(originalId);
    const addedId = layerChildren(canvas)[1];
    expect(engine.layerById(addedId)?.parameterLink?.source.layerId).toBe(addedSourceId);
    engine.removeLayer(addedId);
    await engine.readyToRender();
    expect(layerChildren(canvas)).toEqual([originalId]);
    expect(canvas.parameterLink?.structure?.suppressed).toContain(addedSourceId);
    engine.canvases.restoreChild(canvasId, addedSourceId);
    await engine.readyToRender();
    expect(layerChildren(canvas)).toEqual([originalId, addedId]);
    await engine.undo();
    expect(layerChildren(canvas)).toEqual([originalId]);
    expect(engine.layerById(addedId)).toBeNull();
    await engine.redo();
    expect(layerChildren(canvas)).toEqual([originalId, addedId]);
  });
});


describe('millimeter model values', () => {
  it('keeps shape, image, and text layouts unchanged across PPI changes, save, and Undo', async () => {
    await engine.newProject();
    engine.selectToolInstance(useStore.getState().tools.find(tool => tool.kind === 'pen')!.id);
    const ppi = engine.getPageSpec().ppi, mm = 25.4 / ppi;
    engine.addShapeLayer({kind: 'rect', x: 100, y: 50, width: 80, height: 40, color: '#f00', strokeWidth: 3, paintMode: 'fill-inside'});
    const shapeId = engine.getActiveLayerId();
    const shape = engine.layerById(shapeId)!;
    expect(shape.state).toMatchObject({shape: {x: 100 * mm, y: 50 * mm, width: 80 * mm, strokeWidth: 3 * mm}});
    engine.addTextLayer({...newText(150, 100, '#000', 100, 40), content: 'mm'});
    const textId = engine.getActiveLayerId();
    engine.addImageLayer(document.createElement('canvas'), 200, 100, 120, 80);
    const imageId = engine.getActiveLayerId();
    const ids = [shapeId, textId, imageId];
    const before = ids.map(id => structuredClone(engine.layerById(id)!.state));
    await engine.resizePage({...engine.getPageSpec(), ppi: ppi * 2});
    expect(ids.map(id => engine.layerById(id)!.state)).toEqual(before);
    expect(engine.getShape(shapeId)).toMatchObject({x: 200, y: 100, width: 160, strokeWidth: 6});
    await engine.flushSavePublic();
    const {page} = await loadActivePersisted();
    expect(ids.map(id => page!.layers.find(layer => layer.id === id)!.state)).toEqual(before);
    await engine.undo();
    expect(ids.map(id => engine.layerById(id)!.state)).toEqual(before);
    expect(engine.getShape(shapeId)).toMatchObject({x: 100, y: 50, width: 80, strokeWidth: 3});
  });
});


describe('physical raster transfer', () => {
  it('transfers a shape into a moved raster with a different native PPI and restores both in one Undo', async () => {
    await engine.newProject();
    engine.selectToolInstance(useStore.getState().tools.find(tool => tool.kind === 'pen')!.id);
    const raster = engine.activeRaster()!, ppi = engine.getPageSpec().ppi;
    raster.runtime.surface.restore({...raster.runtime.surface.snapshot(), intrinsicPpi: ppi / 2});
    raster.state.matrix = [1, 0, 20 * 25.4 / ppi, 0, 1, 0, 0, 0, 1];
    engine.addShapeLayer({kind: 'rect', x: 40, y: 20, width: 10, height: 10, color: '#f00', strokeWidth: 0, paintMode: 'fill-inside'});
    const shapeId = engine.getActiveLayerId();
    engine.transferShapeLayer(raster.id);
    await awaitHistoryReady();
    expect(pixel(raster.id, 44, 24)).toEqual([255, 0, 0, 255]);
    expect(pixel(raster.id, 84, 44)[3]).toBe(0);
    expect([...raster.runtime.surface.imageData({x: 12, y: 12, w: 1, h: 1}).data]).toEqual([255, 0, 0, 255]);
    await engine.undo();
    expect(engine.layerById(shapeId)?.type).toBe('shape');
    expect(engine.layerService.rasterById(raster.id)?.runtime.surface.tileCount).toBe(0);
  });
});


describe('editable projective layout', () => {
  const pt = (x: number, y: number) => ({x, y, pressure: 1});
  it('keeps vector geometry in mm and samples the projective result without rasterizing', async () => {
    await engine.newProject();
    engine.selectToolInstance(useStore.getState().tools.find(tool => tool.kind === 'pen')!.id);
    engine.addShapeLayer({kind: 'rect', x: 20, y: 20, width: 20, height: 20, color: '#f00', strokeWidth: 1, paintMode: 'fill-inside'});
    const id = engine.getActiveLayerId(), original = structuredClone(engine.layerById(id)!.state);
    const entries = engine.selectedObjectsInRect({minX: 0, minY: 0, maxX: 100, maxY: 100});
    const from = [{x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 100}, {x: 0, y: 100}];
    const to = [{x: 0, y: 0}, {x: 200, y: 0}, {x: 150, y: 100}, {x: 0, y: 100}];
    engine.previewObjectGroup(entries, from, to); engine.commitObjectGroup(entries);
    const layer = engine.layerById(id)!;
    if (layer.type !== 'shape') throw new Error('vector was replaced');
    expect(layer.state.shape).toEqual((original as typeof layer.state).shape);
    expect(layer.state.matrix?.[7]).not.toBe(0);
    const {project} = await import('./geometry/homography');
    const ppi = engine.getPageSpec().ppi, mm = 25.4 / ppi;
    const center = project(layer.state.matrix!, {x: 30 * mm, y: 30 * mm})!;
    expect([...engine.compositor.samplePixel(center.x / mm, center.y / mm, id)]).toEqual([255, 0, 0, 255]);
    await engine.undo();
    expect(engine.layerById(id)!.state).toEqual(original);
    await engine.redo();
    expect(engine.layerById(id)?.type).toBe('shape');
    expect((engine.layerById(id)!.state as typeof layer.state).matrix?.[7]).not.toBe(0);
  });

  it('inverse maps handle edits through local and upper operators', async () => {
    await engine.newProject();
    engine.selectToolInstance(useStore.getState().tools.find(tool => tool.kind === 'pen')!.id);
    engine.addShapeLayer({kind: 'rect', x: 20, y: 20, width: 40, height: 30, color: '#f00', strokeWidth: 1, paintMode: 'fill-inside'});
    const id = engine.getActiveLayerId(), layer = engine.layerById(id)!;
    if (layer.type !== 'shape') throw new Error();
    layer.state.snapEnabled = false;
    layer.state.matrix = [2, 0, 0, 0, 1, 0, 0, 0, 1];
    engine.addTransformLayer();
    const transform = engine.layerById(engine.getActiveLayerId())!;
    if (transform.type !== 'transform') throw new Error();
    transform.state.matrix = [1, 0, 10 * 25.4 / engine.getPageSpec().ppi, 0, 1, 0, 0, 0, 1];
    engine.setActiveLayer(id);
    expect(engine.beginShapeEdit(pt(50, 20))).toBe(true);
    engine.updateShapeEdit(pt(70, 25)); engine.finishShapeEdit(pt(70, 25));
    expect(engine.getShape(id)).toMatchObject({x: expect.closeTo(30), y: expect.closeTo(25), width: expect.closeTo(30), height: expect.closeTo(25)});
    expect(layer.state.matrix).toEqual([2, 0, 0, 0, 1, 0, 0, 0, 1]);
    await engine.undo();
    expect(engine.getShape(id)).toMatchObject({x: 20, y: 20, width: 40, height: 30});
  });
});


describe('deleted shared sources', () => {
  it('materializes current fields and reconnects an untouched consumer on deletion Undo', async () => {
    await engine.newProject();
    engine.addShapeLayer({kind:'rect',x:10,y:10,width:20,height:20,color:'#f00',strokeWidth:1,paintMode:'fill-inside'});
    const source=engine.getActiveLayerId();
    engine.addShapeLayer({kind:'rect',x:0,y:0,width:10,height:10,color:'#000',strokeWidth:1,paintMode:'fill-inside'});
    const target=engine.getActiveLayerId();
    engine.links.createPasteLink(target,{document:engine.documentKey,layerId:source});
    const before=engine.getShape(source)!;
    engine.updateShapeParams(source,before,{...before,color:'#00f'});
    engine.removeLayer(source);
    await engine.canvases.flush();
    expect(engine.getShape(target)?.color).toBe('#00f');
    expect(engine.layerById(target)?.parameterLink).toBeUndefined();
    await engine.undo();
    expect(engine.layerById(target)?.parameterLink?.source.layerId).toBe(source);
    expect(engine.getShape(target)?.color).toBe('#00f');
  });
});

it('follows canvas additions through an unopened bin variant using stable lightweight occurrences', async () => {
  await engine.newProject();
  engine.selectToolInstance(useStore.getState().tools.find(tool=>tool.kind==='pen')!.id);
  engine.addCanvasLayer();const root=engine.getActiveLayerId();
  engine.addShapeLayer({kind:'rect',x:10,y:10,width:20,height:20,color:'#f00',strokeWidth:1,paintMode:'fill-inside'});
  const first=engine.getActiveLayerId();
  await engine.bins.register(root);const original=engine.bins.items[0].id;
  await engine.bins.register(root);const variant=engine.bins.items.find(item=>item.id!==original)!.id;
  engine.scheduleSave();await engine.flushSavePublic();
  const stored=(await loadActivePersisted()).page!;
  expect(stored.layers.find(layer=>layer.id===first)).toMatchObject({referenceOnly:true,state:{}});
  expect(stored.layers.find(layer=>layer.id===first)?.content).toBeUndefined();
  await engine.bins.open(original);engine.setActiveLayer(root);
  engine.addShapeLayer({kind:'rect',x:50,y:50,width:10,height:10,color:'#00f',strokeWidth:1,paintMode:'fill-inside'});
  await engine.bins.returnToPage();await engine.readyToRender();
  const children=layerChildren(engine.layerById(root)!);
  expect(children).toHaveLength(2);
  const newId=children.find(id=>id!==first)!;
  expect(engine.getShape(newId)?.color).toBe('#00f');
  await engine.bins.open(variant);await engine.bins.returnToPage();await engine.readyToRender();
  expect(layerChildren(engine.layerById(root)!)).toEqual(children);
});

it('preserves a bin source at deletion time and keeps the page history independent',async()=>{
  await engine.newProject();const id=engine.getActiveLayerId();paintRaster(id,-10000,20000,2,2,'#00f');
  await engine.bins.register(id);const bin=engine.bins.items[0];
  const history=internalHistory().current.id;
  await engine.bins.remove(bin.id);
  expect(engine.bins.items).toHaveLength(0);
  expect(engine.layerById(id)?.parameterLink).toBeUndefined();
  const raster=engine.layerService.rasterById(id)!;
  expect([...raster.runtime.surface.imageData({x:-10000,y:20000,w:1,h:1}).data]).toEqual([0,0,255,255]);
  expect(internalHistory().current.id).toBe(history);
  engine.scheduleSave();await engine.flushSavePublic();
  const saved=(await loadActivePersisted()).page!;
  await engine.restoreSavedPagePublic(saved);engine.links.reconcileAll();await engine.readyToRender();
  expect([...engine.layerService.rasterById(id)!.runtime.surface.imageData({x:-10000,y:20000,w:1,h:1}).data]).toEqual([0,0,255,255]);
});

describe('bounded layer workloads',()=>{
  it('keeps distant signed strokes sparse through archive and a region query',async()=>{
    await engine.newProject();const id=engine.getActiveLayerId(),raster=engine.layerService.rasterById(id)!;
    const start=performance.now();
    paintRaster(id,-1e9,1e9,2,2,'#f00');paintRaster(id,1e9,-1e9,2,2,'#00f');
    const content=await raster.runtime.surface.encode();
    expect(raster.runtime.surface.tileCount).toBe(2);expect(content.size).toBeLessThan(4096);
    const bounds=raster.runtime.surface.bounds()!;expect(bounds.w).toBeGreaterThan(1e9);
    expect([...raster.runtime.surface.imageData({x:-1e9,y:1e9,w:1,h:1}).data]).toEqual([255,0,0,255]);
    console.info(`遠隔描画: ${Math.round(performance.now()-start)}ms / ${raster.runtime.surface.tileCount} tiles / ${content.size} bytes`);
  });
  it('shares actual tile resources across twenty page occurrences',async()=>{
    await engine.newProject();const id=engine.getActiveLayerId();paintRaster(id,10,10,16,16,'#f00');
    await engine.bins.register(id);const bin=engine.bins.items[0],start=performance.now();
    for(let index=0;index<20;index++)await engine.bins.addToPage(bin.id);
    await engine.readyToRender();
    const rasters=engine.allLayers().filter(layer=>layer.type==='raster');
    const tiles=new Set(rasters.flatMap(layer=>[...layer.runtime.surface.snapshot().tiles.values()]));
    expect(rasters).toHaveLength(21);expect(tiles.size).toBe(1);
    console.info(`共有素材21配置: ${Math.round(performance.now()-start)}ms / ${tiles.size} unique tile`);
  });
  it('bounds intermediate allocations for nested canvases and effects',async()=>{
    await engine.newProject();await engine.resizePage({...engine.getPageSpec(),widthMm:768,heightMm:768,ppi:25.4});
    engine.addCanvasLayer();const outer=engine.getActiveLayerId();engine.addCanvasLayer();engine.addCanvasLayer();
    engine.addShapeLayer({kind:'rect',x:250,y:250,width:40,height:40,color:'#f00',strokeWidth:1,paintMode:'fill-inside'});
    engine.addOutlineLayer();const outline=engine.layerById(engine.getActiveLayerId())!;
    if(outline.type==='outline')outline.state.outline.widthMm=2;
    engine.setActiveLayer(outer);await engine.canvases.flush();
    const borrow=vi.spyOn(engine.compositor,'borrowCanvas'),start=performance.now();
    try {
      const main=document.createElement('canvas'),overlay=document.createElement('canvas');main.width=main.height=overlay.width=overlay.height=768;
      engine.compositor.attachCanvases(main,overlay);engine.requestRender();engine.ensureComposited();
      expect(borrow.mock.calls.every(([width,height])=>(width??768)<=512&&(height??768)<=512)).toBe(true);
      console.info(`入れ子キャンバスと効果: ${Math.round(performance.now()-start)}ms / intermediate side ≤512px`);
    } finally {borrow.mockRestore();engine.compositor.detachCanvases();}
  });
});
