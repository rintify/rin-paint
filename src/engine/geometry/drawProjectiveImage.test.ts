// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { drawProjectiveImage } from './drawProjectiveImage';
import { fromQuads, corners, inverse, multiply, project } from './homography';

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

function surface(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width=w; canvas.height=h;
  return canvas;
}

describe('projective image drawing', () => {
  it('inverse samples the same homography through the caller view across output tile boundaries', () => {
    const source = surface(300,40), paint=source.getContext('2d')!;
    paint.fillStyle='#ff0000'; paint.fillRect(0,0,150,40);
    paint.fillStyle='#0000ff'; paint.fillRect(150,0,150,40);
    const target=surface(600,120), ctx=target.getContext('2d')!;
    ctx.translate(12,10); ctx.scale(1.1,1.2);
    const m=fromQuads(corners({x:0,y:0,w:300,h:40}),[{x:0,y:0},{x:420,y:5},{x:370,y:75},{x:15,y:65}])!;
    drawProjectiveImage(ctx,source,m);
    const inv=inverse(multiply([1.1,0,12,0,1.2,10,0,0,1],m))!;
    for (const x of [40,120,255,256,300,360]) {
      const sample=project(inv,{x:x+.5,y:40.5})!;
      const pixel=ctx.getImageData(x,40,1,1).data;
      expect([...pixel]).toEqual(sample.x < 150 ? [255,0,0,255] : [0,0,255,255]);
    }
    expect(ctx.getTransform().e).toBe(12);
    expect(ctx.getTransform().f).toBe(10);
  });

  it('preserves target clipping and applies opacity once', () => {
    const source=surface(20,20), paint=source.getContext('2d')!;
    paint.fillStyle='red'; paint.fillRect(0,0,20,20);
    const target=surface(40,40), ctx=target.getContext('2d')!;
    ctx.beginPath();ctx.rect(0,0,10,40);ctx.clip();ctx.globalAlpha=.5;
    const m=fromQuads(corners({x:0,y:0,w:20,h:20}),[{x:0,y:0},{x:30,y:0},{x:25,y:30},{x:0,y:25}])!;
    drawProjectiveImage(ctx,source,m);
    expect(ctx.getImageData(5,5,1,1).data[3]).toBe(128);
    expect(ctx.getImageData(15,5,1,1).data[3]).toBe(0);
    expect(ctx.globalAlpha).toBeCloseTo(.5,2);
  });
});
