// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { Compositor } from './Compositor';
import {
  createAdjustLayer,
  createClipLayer,
  createOutlineLayer,
  createRasterLayer,
  type Layer,
  type RasterLayer,
} from '../layers';
import type { PaintEngine } from '../PaintEngine';

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

function raster(id: string, paint: (ctx: CanvasRenderingContext2D) => void): RasterLayer {
  const layer = createRasterLayer(id, 16, 16, id);
  paint(layer.runtime.ctx);
  return layer;
}

function render(layers: Layer[], roots: string[], ppi = 25.4): HTMLCanvasElement {
  return createRenderer(layers, roots, ppi).main;
}

function createRenderer(layers: Layer[], roots: string[], ppi = 25.4) {
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  const revisions = new Map<string, number>();
  const engine = {
    artboard: { w: 16, h: 16 },
    allLayers: () => layers,
    layerById: (id: string) => byId.get(id) ?? null,
    getRootLayerIds: () => roots,
    getCanvasSpec: () => ({ widthMm: 16, heightMm: 16, ppi }),
    getRenderRevision: (id: string) => revisions.get(id) ?? 0,
    getMaskRevision: (id: string) => revisions.get(id) ?? 0,
    activeTool: () => ({}),
    drawActiveShapeHandles() {},
    drawLoupeIfAny() {},
    bumpLayer() {},
    syncStore() {},
  } as unknown as PaintEngine;
  const compositor = new Compositor(engine);
  const main = document.createElement('canvas');
  const overlay = document.createElement('canvas');
  main.width = overlay.width = 16;
  main.height = overlay.height = 16;
  compositor.attachCanvases(main, overlay);
  compositor.composite();
  return { main, overlay, compositor, revisions };
}

function rgba(canvas: HTMLCanvasElement, x: number, y: number): number[] {
  return [...canvas.getContext('2d')!.getImageData(x, y, 1, 1).data];
}

describe('effect scopes', () => {
  it('applies root adjustment to preceding roots and uses opacity as effect strength', () => {
    const source = raster('source', ctx => { ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 16, 16); });
    const adjust = createAdjustLayer('色調補正', 'adjust');
    adjust.state.params.brightness = 0;
    adjust.opacity = .5;
    const result = render([source, adjust], [source.id, adjust.id]);
    const pixel = rgba(result, 4, 4);
    expect(pixel[0]).toBeGreaterThanOrEqual(127);
    expect(pixel[0]).toBeLessThanOrEqual(128);
    expect(pixel.slice(1)).toEqual([0, 0, 255]);
  });

  it('clips only the parent scope, ignores hidden mask visibility, and leaves later children above the effect', () => {
    const lower = raster('lower', ctx => { ctx.fillStyle = '#0000ff'; ctx.fillRect(0, 0, 16, 16); });
    const parent = raster('parent', ctx => { ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 16, 16); });
    const mask = raster('mask', ctx => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 8, 16); });
    mask.visible = false;
    mask.parentId = parent.id;
    const clip = createClipLayer('クリップ', 'clip');
    clip.parentId = parent.id;
    clip.state.maskLayerIds = [mask.id];
    const later = raster('later', ctx => { ctx.fillStyle = '#00ff00'; ctx.fillRect(10, 0, 1, 1); });
    later.parentId = parent.id;
    parent.childIds = [mask.id, clip.id, later.id];

    const result = render([lower, parent, mask, clip, later], [lower.id, parent.id]);
    expect(rgba(result, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(rgba(result, 12, 2)).toEqual([0, 0, 255, 255]);
    expect(rgba(result, 10, 0)).toEqual([0, 255, 0, 255]);
  });

  it('keeps a nested child effect scoped to the parent even when its effect parent is hidden', () => {
    const lower = raster('lower', ctx => { ctx.fillStyle = '#0000ff'; ctx.fillRect(0, 0, 16, 16); });
    const parent = raster('parent', ctx => { ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 16, 16); });
    const mask = raster('mask', ctx => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 8, 16); });
    mask.visible = false;
    const skipped = createClipLayer('非表示クリップ', 'skipped');
    skipped.visible = false;
    skipped.parentId = parent.id;
    const nested = createClipLayer('子クリップ', 'nested');
    nested.parentId = skipped.id;
    nested.state.maskLayerIds = [mask.id];
    skipped.childIds = [nested.id];
    parent.childIds = [skipped.id];
    const result = render([lower, parent, mask, skipped, nested], [lower.id, parent.id, mask.id]);
    expect(rgba(result, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(rgba(result, 12, 2)).toEqual([0, 0, 255, 255]);
  });

  it('uses layer opacity as clip strength and treats no mask as a complete no-op', () => {
    const source = raster('source', ctx => { ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 16, 16); });
    const halfMask = raster('mask', ctx => { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, 16, 16); });
    halfMask.visible = false;
    const clip = createClipLayer('クリップ', 'clip');
    clip.state.maskLayerIds = [halfMask.id];
    clip.opacity = .5;
    const clipped = render([source, halfMask, clip], [source.id, halfMask.id, clip.id]);
    // source alpha = .75 over the final white presentation background.
    const clippedPixel = rgba(clipped, 4, 4);
    expect(clippedPixel[0]).toBe(255);
    expect(clippedPixel[1]).toBeGreaterThanOrEqual(63);
    expect(clippedPixel[1]).toBeLessThanOrEqual(64);
    expect(clippedPixel[2]).toBeGreaterThanOrEqual(63);
    expect(clippedPixel[2]).toBeLessThanOrEqual(64);
    expect(clippedPixel[3]).toBe(255);

    clip.state.maskLayerIds = [];
    expect(rgba(render([source, halfMask, clip], [source.id, halfMask.id, clip.id]), 4, 4))
      .toEqual([255, 0, 0, 255]);
  });

  it('OR-combines multiple mask alphas and includes each mask layer opacity', () => {
    const source = raster('source', ctx => { ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 16, 16); });
    const left = raster('left-mask', ctx => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 10, 16); });
    const right = raster('right-mask', ctx => { ctx.fillStyle = '#000'; ctx.fillRect(6, 0, 10, 16); });
    left.visible = right.visible = false;
    left.opacity = right.opacity = .5;
    const clip = createClipLayer('クリップ', 'clip');
    clip.state.maskLayerIds = [left.id, right.id];
    const result = render([source, left, right, clip], [source.id, left.id, right.id, clip.id]);
    expect(rgba(result, 2, 2)).toEqual([255, 127, 127, 255]);
    expect(rgba(result, 8, 2)).toEqual([255, 64, 64, 255]);
    expect(rgba(result, 14, 2)).toEqual([255, 127, 127, 255]);
  });

  it('draws an antialiased outside outline beneath qualifying semi-transparent pixels', () => {
    const source = raster('source', ctx => {
      const pixel = ctx.createImageData(1, 1);
      pixel.data.set([255, 0, 0, 128]);
      ctx.putImageData(pixel, 8, 8);
      pixel.data.set([255, 0, 0, 127]);
      ctx.putImageData(pixel, 3, 3);
    });
    const outline = createOutlineLayer('縁どり', 'outline');
    outline.state.outline = { color: '#000000', widthMm: 1, alphaThreshold: .5 };
    const result = render([source, outline], [source.id, outline.id]);
    const center = rgba(result, 8, 8);
    expect(center[0]).toBeGreaterThan(100);
    expect(center[0]).toBeLessThan(200);
    expect(center[1]).toBe(0);
    expect(rgba(result, 7, 8)[0]).toBeLessThan(200);
    expect(rgba(result, 5, 8)).toEqual([255, 255, 255, 255]);
    expect(rgba(result, 2, 3)).toEqual([255, 255, 255, 255]);
  });

  it('uses the current page PPI when converting outline millimetres to pixels', () => {
    const source = raster('source', ctx => { ctx.fillStyle = '#fff'; ctx.fillRect(8, 8, 1, 1); });
    const outline = createOutlineLayer('縁どり', 'outline');
    outline.state.outline = { color: '#000000', widthMm: 1, alphaThreshold: .5 };
    const low = render([source, outline], [source.id, outline.id], 25.4);
    expect(rgba(low, 6, 8)).toEqual([255, 255, 255, 255]);
    const high = render([source, outline], [source.id, outline.id], 50.8);
    expect(rgba(high, 6, 8)[0]).toBeLessThan(200);
  });

  it('switches outline expansion corners between round and sharp', () => {
    const source = raster('source', ctx => { ctx.fillStyle = '#fff'; ctx.fillRect(8, 8, 1, 1); });
    const outline = createOutlineLayer('縁どり', 'outline');
    outline.state.outline = { color: '#000000', widthMm: 2, alphaThreshold: .5, cornerStyle: 'round' };
    const round = render([source, outline], [source.id, outline.id]);
    outline.state.outline.cornerStyle = 'sharp';
    const sharp = render([source, outline], [source.id, outline.id]);
    expect(rgba(round, 6, 6)).toEqual([255, 255, 255, 255]);
    expect(rgba(sharp, 6, 6)[0]).toBeLessThan(200);
  });

  it('recomposites only the invalidated pixels when no spatial effect expands them', () => {
    const source = raster('source', ctx => { ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 16, 16); });
    const { main, compositor, revisions } = createRenderer([source], [source.id]);
    source.runtime.ctx.fillStyle = '#0000ff';
    source.runtime.ctx.fillRect(3, 4, 1, 1);
    revisions.set(source.id, 1);
    compositor.invalidateLayer(source.id, { minX: 3, minY: 4, maxX: 4, maxY: 5 });
    compositor.ensureComposited();
    expect(rgba(main, 3, 4)).toEqual([0, 0, 255, 255]);
    expect(rgba(main, 2, 4)).toEqual([255, 0, 0, 255]);
    expect(compositor.lastCompositedPixels).toBe(1);
  });

  it('keeps local clip recomposition aligned with artboard coordinates', () => {
    const source = raster('source', ctx => { ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 16, 16); });
    const mask = raster('mask', ctx => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 8, 16); });
    mask.visible = false;
    const clip = createClipLayer('クリップ', 'clip');
    clip.state.maskLayerIds = [mask.id];
    const { main, compositor, revisions } = createRenderer([source, mask, clip], [source.id, mask.id, clip.id]);
    source.runtime.ctx.fillStyle = '#00ff00';
    source.runtime.ctx.fillRect(3, 4, 1, 1);
    revisions.set(source.id, 1);
    compositor.invalidateLayer(source.id, { minX: 3, minY: 4, maxX: 4, maxY: 5 });
    compositor.ensureComposited();
    expect(rgba(main, 3, 4)).toEqual([0, 255, 0, 255]);
    expect(rgba(main, 12, 4)).toEqual([255, 255, 255, 255]);
    expect(compositor.lastCompositedPixels).toBe(1);
  });

  it('shares an OR mask cache and does not invalidate it for visibility changes', () => {
    const source = raster('source', ctx => { ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 16, 16); });
    const left = raster('left', ctx => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 8, 16); });
    const right = raster('right', ctx => { ctx.fillStyle = '#000'; ctx.fillRect(8, 0, 8, 16); });
    left.visible = right.visible = false;
    const clip = createClipLayer('クリップ', 'clip');
    clip.state.maskLayerIds = [left.id, right.id];
    const { compositor } = createRenderer([source, left, right, clip], [source.id, left.id, right.id, clip.id]);
    expect(compositor.renderStats()).toMatchObject({ maskCacheHits: 0, maskCacheMisses: 1 });
    left.visible = true;
    compositor.requestRender();
    compositor.ensureComposited();
    expect(compositor.renderStats()).toMatchObject({ maskCacheHits: 1, maskCacheMisses: 1 });
  });

  it('reuses the outline distance field for width changes and rebuilds it for threshold changes', () => {
    const source = raster('source', ctx => { ctx.fillStyle = '#fff'; ctx.fillRect(8, 8, 1, 1); });
    const outline = createOutlineLayer('縁どり', 'outline');
    const { compositor, revisions } = createRenderer([source, outline], [source.id, outline.id]);
    expect(compositor.renderStats()).toMatchObject({ effectCacheHits: 0, effectCacheMisses: 1 });
    outline.state.outline.widthMm = 2;
    revisions.set(outline.id, 1);
    compositor.requestRender();
    compositor.ensureComposited();
    expect(compositor.renderStats()).toMatchObject({ effectCacheHits: 1, effectCacheMisses: 1 });
    outline.state.outline.alphaThreshold = .75;
    revisions.set(outline.id, 2);
    compositor.requestRender();
    compositor.ensureComposited();
    expect(compositor.renderStats()).toMatchObject({ effectCacheHits: 1, effectCacheMisses: 2 });
  });

  it('expands local damage by the outline radius without recompositing the whole page', () => {
    const source = raster('source', ctx => { ctx.fillStyle = '#fff'; ctx.fillRect(8, 8, 1, 1); });
    const outline = createOutlineLayer('縁どり', 'outline');
    const { main, compositor, revisions } = createRenderer([source, outline], [source.id, outline.id]);
    source.runtime.ctx.fillStyle = '#fff';
    source.runtime.ctx.fillRect(3, 3, 1, 1);
    revisions.set(source.id, 1);
    compositor.invalidateLayer(source.id, { minX: 3, minY: 3, maxX: 4, maxY: 4 });
    compositor.ensureComposited();
    expect(rgba(main, 2, 3)[0]).toBeLessThan(200);
    expect(compositor.lastCompositedPixels).toBeLessThan(16 * 16);
  });

  it('does not expand damage for an outline isolated in another child scope', () => {
    const source = raster('source', ctx => { ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 16, 16); });
    const parent = raster('parent', ctx => { ctx.fillStyle = '#fff'; ctx.fillRect(12, 12, 1, 1); });
    const outline = createOutlineLayer('縁どり', 'outline');
    outline.parentId = parent.id;
    parent.childIds = [outline.id];
    const { main, compositor, revisions } = createRenderer(
      [source, parent, outline],
      [source.id, parent.id],
    );
    source.runtime.ctx.fillStyle = '#00f';
    source.runtime.ctx.fillRect(3, 4, 1, 1);
    revisions.set(source.id, 1);
    compositor.invalidateLayer(source.id, { minX: 3, minY: 4, maxX: 4, maxY: 5 });
    compositor.ensureComposited();
    expect(rgba(main, 3, 4)).toEqual([0, 0, 255, 255]);
    expect(compositor.lastCompositedPixels).toBe(1);
  });

  it('does not dirty the scene for an overlay-only request', () => {
    const source = raster('source', ctx => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 16, 16); });
    const { compositor } = createRenderer([source], [source.id]);
    expect(compositor.dirty).toBe(false);
    compositor.requestOverlayRender();
    expect(compositor.dirty).toBe(false);
  });

  it('keeps clip and adjustment entirely off the CPU pixel-readback path', () => {
    const source = raster('source', ctx => { ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 16, 16); });
    const mask = raster('mask', ctx => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 8, 16); });
    mask.visible = false;
    const clip = createClipLayer('クリップ', 'clip');
    clip.state.maskLayerIds = [mask.id];
    const clipped = createRenderer([source, mask, clip], [source.id, mask.id, clip.id]);
    expect(clipped.compositor.renderStats()).toMatchObject({ cpuReadbackPixels: 0, canvasBorrows: 1 });

    const adjust = createAdjustLayer('補正', 'adjust');
    adjust.state.params.brightness = 50;
    const adjusted = createRenderer([source, adjust], [source.id, adjust.id]);
    expect(adjusted.compositor.renderStats()).toMatchObject({ cpuReadbackPixels: 0, canvasBorrows: 2 });
  });

  it('renders operation overlays at viewport device-pixel resolution', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    try {
      let transformA = Number.NaN;
      let transformD = Number.NaN;
      const engine = {
        artboard: { w: 16, h: 16 },
        view: { x: 5, y: 6, rot: 0, displayScale: () => 2 },
        activeTool: () => ({ drawOverlay: (ctx: CanvasRenderingContext2D) => {
          const value = ctx.getTransform();
          transformA = value.a;
          transformD = value.d;
        } }),
        drawActiveShapeHandles() {},
        drawLoupeIfAny() {},
      } as unknown as PaintEngine;
      const compositor = new Compositor(engine);
      const main = document.createElement('canvas');
      const overlay = document.createElement('canvas');
      const area = document.createElement('div');
      Object.defineProperties(area, {
        clientWidth: { configurable: true, value: 100 },
        clientHeight: { configurable: true, value: 80 },
      });
      compositor.attachCanvases(main, overlay, area);
      compositor.drawOverlayFrame();

      expect([overlay.width, overlay.height]).toEqual([200, 160]);
      expect(transformA).toBe(4);
      expect(transformD).toBe(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
