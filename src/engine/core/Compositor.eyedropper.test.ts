import { paintRaster } from '../raster/testing';
// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import type { PaintEngine } from '../PaintEngine';
import {
  createClipLayer,
  createOutlineLayer,
  createRasterLayer,
  createShapeLayer,
  createTextLayer,
  type Layer,
} from '../layers';
import { Compositor } from './Compositor';

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

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    function (this: HTMLCanvasElement) {
      const node = this;
      const ctx = backing(node).getContext('2d');
      return new Proxy(ctx, {
        get(target, key) {
          if (key === 'canvas') return node;
          if (key === 'drawImage') {
            return (source: HTMLCanvasElement | Canvas, ...args: number[]) =>
              (target.drawImage as Function)(
                source instanceof HTMLCanvasElement ? backing(source) : source,
                ...args,
              );
          }
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, key, value) {
          return Reflect.set(target, key, value, target);
        },
      }) as unknown as CanvasRenderingContext2D;
    },
  );
});
afterAll(() => vi.restoreAllMocks());

function compositorFor(layers: Layer[]): Compositor {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const engine = {
    artboard: { w: 16, h: 16 },
    allLayers: () => layers,
    layerById: (id: string) => byId.get(id) ?? null,
    getRootLayerIds: () =>
      layers
        .filter((layer) => layer.parentId === null)
        .map((layer) => layer.id),
    getPageSpec: () => ({ widthMm: 16, heightMm: 16, ppi: 25.4 }),
    getRenderRevision: () => 0,
    getMaskRevision: () => 0,
    activeTool: () => ({}),
  } as unknown as PaintEngine;
  const compositor = new Compositor(engine);
  const main = document.createElement('canvas');
  const overlay = document.createElement('canvas');
  main.width = overlay.width = 16;
  main.height = overlay.height = 16;
  compositor.attachCanvases(main, overlay);
  return compositor;
}

describe('Compositor eyedropper sampling', () => {
  it('samples vector shapes from the selected layer and the final composite independently', () => {
    const raster = createRasterLayer('背景', 16, 16, 'background');
    paintRaster(raster, (ctx) => {
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(0, 0, 16, 16);
    });
    const shape = createShapeLayer(
      '図形',
      {
        kind: 'rect',
        x: 2,
        y: 2,
        width: 8,
        height: 8,
        color: '#ff0000',
        strokeWidth: 1,
        paintMode: 'fill-inside',
      },
      'shape',
    );
    const compositor = compositorFor([raster, shape]);

    expect([...compositor.samplePixel(5, 5, shape.id)]).toEqual([
      255, 0, 0, 255,
    ]);
    expect([...compositor.samplePixel(14, 14, shape.id)]).toEqual([0, 0, 0, 0]);
    expect([...compositor.samplePixel(14, 14, null)]).toEqual([0, 0, 255, 255]);
  });

  it('uses the text layer renderer when sampling a selected text layer', () => {
    const text = createTextLayer(
      '文字',
      {
        content: 'A',
        x: 0,
        y: 0,
        width: null,
        height: null,
        direction: 'horizontal',
        horizontalAlign: 'left',
        verticalAlign: 'top',
        lineHeight: 1.2,
        style: { fontId: 'sans-serif', sizePt: 12, color: '#00ff00' },
        ranges: [],
        ruby: [],
      },
      'text',
    );
    const compositor = compositorFor([text]);
    vi.spyOn(compositor.textRenderer, 'draw').mockImplementation((ctx) => {
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(0, 0, 8, 8);
    });

    expect([...compositor.samplePixel(3, 3, text.id)]).toEqual([
      0, 255, 0, 255,
    ]);
  });

  it('samples only the generated border from a selected outline layer', () => {
    const raster = createRasterLayer('元画像', 16, 16, 'source');
    paintRaster(raster, (ctx) => {
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(5, 5, 4, 4);
    });
    const outline = createOutlineLayer('縁どり', 'outline');
    outline.state.outline = {
      color: '#00ff00',
      widthMm: 2,
      alphaThreshold: 0.5,
      cornerStyle: 'round',
    };
    const compositor = compositorFor([raster, outline]);

    expect([...compositor.samplePixel(3, 6, outline.id)]).toEqual([
      0, 255, 0, 128,
    ]);
    expect([...compositor.samplePixel(6, 6, outline.id)]).toEqual([0, 0, 0, 0]);
  });

  it('uses an outline layer contribution as a clip mask', () => {
    const raster = createRasterLayer('元画像', 16, 16, 'source');
    paintRaster(raster, (ctx) => {
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(5, 5, 4, 4);
    });
    const outline = createOutlineLayer('縁どり', 'outline');
    outline.state.outline = {
      color: '#00ff00',
      widthMm: 2,
      alphaThreshold: 0.5,
      cornerStyle: 'round',
    };
    const clip = createClipLayer('クリップ', 'clip');
    clip.state.maskLayerIds = [outline.id];
    const compositor = compositorFor([raster, outline, clip]);

    expect([...compositor.samplePixel(3, 6, null)]).toEqual([0, 255, 0, 64]);
    expect([...compositor.samplePixel(6, 6, null)]).toEqual([0, 0, 0, 0]);
  });
});
