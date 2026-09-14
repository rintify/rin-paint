import { scopeOwner } from '../layerTree';
// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import type { PaintEngine } from '../PaintEngine';
import {
  createAdjustLayer,
  createCanvasLayer,
  createClipLayer,
  createImageLayer,
  createOutlineLayer,
  createRasterLayer,
  createShapeLayer,
  createTextLayer,
  makeCanvas,
  type Layer,
} from '../layers';
import { Compositor } from './Compositor';
import { LayerPicker } from './LayerPicker';
import { CursorTool } from '../../tools/cursor/tool';
import { useStore } from '../../state/store';
import type { ToolKind } from '../../tools/registry';

const native = new WeakMap<HTMLCanvasElement, Canvas>();
function backing(node: HTMLCanvasElement): Canvas {
  let canvas = native.get(node);
  if (!canvas) { canvas = createCanvas(node.width, node.height); native.set(node, canvas); }
  if (canvas.width !== node.width) canvas.width = node.width;
  if (canvas.height !== node.height) canvas.height = node.height;
  return canvas;
}

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const node = this;
    const ctx = backing(this).getContext('2d');
    return new Proxy(ctx, {
      get(target, key) {
        if (key === 'canvas') return node;
        if (key === 'drawImage') {
          return (source: HTMLCanvasElement | Canvas, ...args: number[]) =>
            (target.drawImage as Function)(source instanceof HTMLCanvasElement ? backing(source) : source, ...args);
        }
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, key, value) { return Reflect.set(target, key, value, target); },
    }) as unknown as CanvasRenderingContext2D;
  });
});
afterAll(() => vi.restoreAllMocks());

function raster(id: string, paint: (ctx: CanvasRenderingContext2D) => void) {
  const layer = createRasterLayer(id, 25.4, id);
  layer.runtime.surface.paint({x: 0, y: 0, w: 16, h: 16}, paint);
  return layer;
}

function pickerFor(layers: Layer[], roots?: string[]) {
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  const engine = {
    artboard: { w: 16, h: 16 },
    allLayers: () => layers,
    getActiveLayerId: () => layers.find(layer => scopeOwner(layers, layer.id) === null)?.id ?? '',
    layerById: (id: string) => byId.get(id) ?? null,
    getRootLayerIds: () => roots ?? layers.filter(layer => scopeOwner(layers, layer.id) === null).map(layer => layer.id),
    getPageSpec: () => ({ widthMm: 16, heightMm: 16, ppi: 25.4 }),
    getRenderRevision: () => 0,
    getMaskRevision: () => 0,
    activeTool: () => ({}),
  } as unknown as PaintEngine;
  const compositor = new Compositor(engine);
  (engine as unknown as { compositor: Compositor }).compositor = compositor;
  const main = document.createElement('canvas');
  const overlay = document.createElement('canvas');
  main.width = overlay.width = 16;
  main.height = overlay.height = 16;
  compositor.attachCanvases(main, overlay);
  return { picker: new LayerPicker(engine), compositor, engine };
}

function pickId(picker: LayerPicker, x: number, y: number): string | null {
  const hit = picker.pickAt(x, y);
  hit?.mask.release();
  return hit?.layerId ?? null;
}

function maskAlpha(compositor: Compositor, layerId: string, x: number, y: number): number {
  const mask = compositor.renderLayerHitMask(layerId);
  const alpha = mask.ctx.getImageData(x, y, 1, 1).data[3];
  mask.release();
  return alpha;
}

describe('layer picking from visible pixels', () => {
  it('selects the frontmost layer whose own pixels cover the point', () => {
    const back = raster('back', ctx => { ctx.fillStyle = '#00f'; ctx.fillRect(0, 0, 16, 16); });
    const front = raster('front', ctx => { ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 8, 8); });
    const { picker } = pickerFor([back, front]);
    expect(pickId(picker, 2, 2)).toBe(front.id);
    expect(pickId(picker, 12, 12)).toBe(back.id);
  });

  it('ignores transparent raster and image pixels, hidden layers, and points outside the canvas', () => {
    const back = raster('back', ctx => { ctx.fillStyle = '#00f'; ctx.fillRect(0, 0, 16, 16); });
    const holes = raster('holes', ctx => { ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 4, 4); });
    holes.visible = false;
    const source = makeCanvas(16, 16);
    source.getContext('2d')!.fillStyle = '#0f0';
    source.getContext('2d')!.fillRect(8, 8, 4, 4);
    const image = createImageLayer('image', source, { x: 0, y: 0, width: 16, height: 16, rotation: 0 }, 'image');
    const { picker } = pickerFor([back, holes, image]);
    expect(pickId(picker, 2, 2)).toBe(back.id);
    expect(pickId(picker, 10, 10)).toBe(image.id);
    expect(pickId(picker, 2, 10)).toBe(back.id);
    expect(pickId(picker, -1, 4)).toBeNull();
    expect(pickId(picker, 16, 4)).toBeNull();
  });

  it('exposes canvas output as one selectable layer and excludes empty shape interiors', () => {
    const parent = createCanvasLayer('parent', 'parent');
    const base = raster('base', ctx => { ctx.fillStyle = '#00f'; ctx.fillRect(0, 0, 16, 16); });

    const child = raster('child', ctx => { ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 6, 6); });

    parent.childIds = [base.id, child.id];
    const frame = createShapeLayer('枠', {
      kind: 'rect', x: 2, y: 2, width: 10, height: 10, color: '#0f0',
      strokeWidth: 2, paintMode: 'stroke',
    }, 'stroke');
    const { picker } = pickerFor([parent, base, child, frame], [parent.id, frame.id]);
    expect(pickId(picker, 4, 4)).toBe(parent.id);
    expect(pickId(picker, 10, 10)).toBe(parent.id);
    expect(pickId(picker, 7, 7)).toBe(parent.id);
    expect(pickId(picker, 2, 7)).toBe(frame.id);
  });

  it('keeps the current selection on a completely empty click', () => {
    const empty = raster('empty', () => undefined);
    const { picker } = pickerFor([empty]);
    expect(pickId(picker, 4, 4)).toBeNull();
  });

  it('does not pick original pixels that a later clip removed', () => {
    const source = raster('source', ctx => { ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 16, 16); });
    const mask = raster('mask', ctx => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 8, 16); });
    mask.visible = false;
    const clip = createClipLayer('clip', 'clip');
    clip.state.maskLayerIds = [mask.id];
    const { picker, compositor } = pickerFor([source, mask, clip]);
    expect(pickId(picker, 2, 2)).toBe(source.id);
    expect(pickId(picker, 12, 2)).toBeNull();
    expect(pickId(picker, 2, 2) === clip.id).toBe(false);
    expect(maskAlpha(compositor, source.id, 12, 2)).toBe(0);
  });

  it('picks outline pixels as the outline and original pixels as the source', () => {
    const source = raster('source', ctx => { ctx.fillStyle = '#f00'; ctx.fillRect(5, 5, 4, 4); });
    const outline = createOutlineLayer('outline', 'outline');
    outline.state.outline = { color: '#0f0', widthMm: 2, alphaThreshold: .5, cornerStyle: 'round' };
    const { picker } = pickerFor([source, outline]);
    expect(pickId(picker, 6, 6)).toBe(source.id);
    expect(pickId(picker, 3, 6)).toBe(outline.id);
  });

  it('does not treat adjust or clip layers as click targets', () => {
    const source = raster('source', ctx => { ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 16, 16); });
    const adjust = createAdjustLayer('adjust', 'adjust');
    adjust.state.params.brightness = 50;
    const clip = createClipLayer('clip', 'clip');
    const { picker } = pickerFor([source, adjust, clip]);
    expect(pickId(picker, 4, 4)).toBe(source.id);
  });

  it('uses actual text pixels from the shared renderer', () => {
    const text = createTextLayer('文字', {
      content: 'A', x: 0, y: 0, width: null, height: null, direction: 'horizontal',
      horizontalAlign: 'left', verticalAlign: 'top', lineHeight: 1.2,
      style: { fontId: 'sans-serif', sizeMm: 12 * 25.4 / 72, color: '#00ff00' }, ranges: [], ruby: [],
    }, 'text');
    const { picker, compositor } = pickerFor([text]);
    vi.spyOn(compositor.textRenderer, 'draw').mockImplementation((ctx) => {
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(0, 0, 8, 8);
    });
    expect(pickId(picker, 3, 3)).toBe(text.id);
    expect(pickId(picker, 12, 12)).toBeNull();
  });
});

describe('cursor tool selection', () => {
  const original = useStore.getState();
  afterEach(() => useStore.setState(original, true));

  it('uses setActiveLayer and replays the glow even for the already selected layer', () => {
    const setActiveLayer = vi.fn();
    const release = vi.fn();
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = maskCanvas.height = 16;
    maskCanvas.getContext('2d')!.fillStyle = '#fff';
    maskCanvas.getContext('2d')!.fillRect(2, 2, 4, 4);
    const engine = {
      pickLayerAt: () => ({
        layerId: 'front',
        mask: { canvas: maskCanvas, ctx: maskCanvas.getContext('2d')!, release },
      }),
      setActiveLayer,
      requestOverlayRender: vi.fn(),
      uiScale: () => 1,
      artboard: { w: 16, h: 16 },
    } as unknown as PaintEngine;
    const tool = new CursorTool(engine);
    expect(tool.allowsDirectShapeEdit).toBe(false);
    tool.onDown({ x: 3, y: 3, pressure: 1 }, {} as PointerEvent);
    tool.onDown({ x: 3, y: 3, pressure: 1 }, {} as PointerEvent);
    expect(setActiveLayer).toHaveBeenCalledTimes(2);
    expect(setActiveLayer).toHaveBeenCalledWith('front');
    expect(release).toHaveBeenCalledTimes(2);
    expect(tool.overlayAnimated()).toBe(true);
  });

  it('does not change selection when the click misses every layer', () => {
    const setActiveLayer = vi.fn();
    const tool = new CursorTool({
      pickLayerAt: () => null,
      setActiveLayer,
      requestOverlayRender: vi.fn(),
      uiScale: () => 1,
      artboard: { w: 16, h: 16 },
    } as unknown as PaintEngine);
    tool.onDown({ x: 1, y: 1, pressure: 1 }, {} as PointerEvent);
    expect(setActiveLayer).not.toHaveBeenCalled();
    expect(tool.overlayAnimated()).toBe(false);
  });

  it('toggles membership through setActiveLayer while multi-select is on', () => {
    useStore.setState({
      ...original,
      multiSelectMode: true,
      selectedLayerIds: ['front'],
      activeLayerId: 'front',
      tool: 'cursor' as ToolKind,
    });
    const setActiveLayer = vi.fn((id: string) => {
      const state = useStore.getState();
      const selected = new Set(state.selectedLayerIds);
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      if (selected.size === 0) selected.add(id);
      const selectedLayerIds = [...selected];
      useStore.setState({
        selectedLayerIds,
        activeLayerId: selected.has(id) ? id : selectedLayerIds.at(-1)!,
        multiSelectMode: selectedLayerIds.length > 1,
      });
    });
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = maskCanvas.height = 8;
    const engine = {
      pickLayerAt: () => ({
        layerId: 'back',
        mask: { canvas: maskCanvas, ctx: maskCanvas.getContext('2d')!, release() {} },
      }),
      setActiveLayer,
      requestOverlayRender: vi.fn(),
      uiScale: () => 1,
      artboard: { w: 8, h: 8 },
    } as unknown as PaintEngine;
    const tool = new CursorTool(engine);
    tool.onDown({ x: 1, y: 1, pressure: 1 }, {} as PointerEvent);
    expect(setActiveLayer).toHaveBeenCalledWith('back');
    expect(useStore.getState().selectedLayerIds).toEqual(['front', 'back']);
    tool.onDown({ x: 1, y: 1, pressure: 1 }, {} as PointerEvent);
    expect(useStore.getState().selectedLayerIds).toEqual(['front']);
    expect(useStore.getState().multiSelectMode).toBe(false);
  });
});
