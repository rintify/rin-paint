// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { SparseRasterSurface } from './SparseRasterSurface';

const native = new WeakMap<HTMLCanvasElement, Canvas>();
function backing(node: HTMLCanvasElement): Canvas {
  let canvas = native.get(node);
  if (!canvas) { canvas = createCanvas(node.width, node.height); native.set(node, canvas); }
  return canvas;
}

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const node = this;
    const ctx = backing(this).getContext('2d');
    return new Proxy(ctx, {
      get(target, key) {
        if (key === 'canvas') return node;
        if (key === 'drawImage') return (source: HTMLCanvasElement | Canvas, ...args: number[]) =>
          (target.drawImage as Function)(source instanceof HTMLCanvasElement ? backing(source) : source, ...args);
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, key, value) { return Reflect.set(target, key, value, target); },
    }) as unknown as CanvasRenderingContext2D;
  });
});
afterAll(() => vi.restoreAllMocks());

describe('SparseRasterSurface', () => {
  it('allocates signed tiles only where drawing happens', () => {
    const surface = new SparseRasterSurface(254);
    surface.drawInRect({ x: -260, y: -1, w: 8, h: 8 }, ctx => ctx.fillRect(-260, -1, 8, 8));
    expect([...surface.tiles.values()].map(tile => [tile.tx, tile.ty]).sort((a, b) => a[0] - b[0] || a[1] - b[1])).toEqual([
      [-2, -1], [-2, 0], [-1, -1], [-1, 0],
    ]);
    expect(surface.tileCount).toBe(4);
  });

  it('uses an mm origin independently from signed pixel coordinates', () => {
    const surface = new SparseRasterSurface(254, { x: 10, y: -5 });
    expect(surface.pixelToDocumentMm({ x: -100, y: 20 })).toEqual({ x: 0, y: -3 });
    expect(surface.documentMmToPixel({ x: 0, y: -3 })).toEqual({ x: -100, y: 20 });
  });

  it('renders at the document PPI while preserving physical size and origin', () => {
    const surface = new SparseRasterSurface(100, { x: 25.4, y: 0 });
    surface.drawInRect({ x: 0, y: 0, w: 10, h: 10 }, ctx => {
      ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 10, 10);
    });
    const output = document.createElement('canvas'); output.width = 240; output.height = 40;
    surface.drawDocumentTo(output.getContext('2d')!, { x: 0, y: 0, w: 240, h: 40 }, 200);
    const data = output.getContext('2d')!.getImageData(0, 0, 240, 40).data;
    const alpha = (x: number, y: number) => data[(y * 240 + x) * 4 + 3];
    expect(alpha(199, 5)).toBe(0);
    expect(alpha(200, 5)).toBe(255);
    expect(alpha(218, 5)).toBe(255);
    expect(alpha(221, 5)).toBe(0);
  });

  it('edits in document coordinates across a different raster PPI and mm origin', () => {
    const surface = new SparseRasterSurface(100, { x: 25.4, y: 0 });
    surface.drawDocumentInRect({ x: 200, y: 4, w: 20, h: 20 }, 200, ctx => {
      ctx.fillStyle = '#0088ff';
      ctx.fillRect(200, 4, 20, 20);
    });
    const output = document.createElement('canvas'); output.width = 240; output.height = 40;
    surface.drawDocumentTo(output.getContext('2d')!, { x: 0, y: 0, w: 240, h: 40 }, 200);
    expect([...output.getContext('2d')!.getImageData(205, 10, 1, 1).data]).toEqual([0, 136, 255, 255]);
    expect([...output.getContext('2d')!.getImageData(195, 10, 1, 1).data]).toEqual([0, 0, 0, 0]);
  });
});
