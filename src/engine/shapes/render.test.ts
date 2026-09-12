import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import type { PolygonShapeParams, RectShapeParams } from '../../model';
import { drawShape, shapeVisualPadding } from './index';

function alphaAt(radius: number, x: number, y: number): number {
  const canvas = createCanvas(30, 30);
  const shape: RectShapeParams = {
    kind: 'rect', x: 5, y: 5, width: 20, height: 20,
    color: '#000000', strokeWidth: 1, paintMode: 'fill-inside', cornerRadius: radius,
  };
  drawShape(canvas.getContext('2d') as unknown as CanvasRenderingContext2D, shape, false, { w: 30, h: 30 });
  return canvas.getContext('2d').getImageData(x, y, 1, 1).data[3];
}

describe('shape corner rendering', () => {
  it('reserves the full miter extent when invalidating a sharp stroked shape', () => {
    const base: RectShapeParams = {
      kind: 'rect', x: 0, y: 0, width: 20, height: 20,
      color: '#000', strokeWidth: 6, paintMode: 'stroke',
    };
    expect(shapeVisualPadding({ ...base, strokeJoin: 'round' })).toBe(5);
    expect(shapeVisualPadding({ ...base, strokeJoin: 'miter' })).toBeCloseTo(3 / Math.sin(Math.PI / 4) + 2);
  });

  it('uses the configured geometry radius without changing the rectangle bounds', () => {
    expect(alphaAt(0, 5, 5)).toBeGreaterThan(0);
    expect(alphaAt(6, 5, 5)).toBe(0);
    expect(alphaAt(6, 10, 10)).toBeGreaterThan(0);
  });

  it('closes a rounded polygon at its tangent instead of drawing a spur to the raw last vertex', () => {
    const canvas = createCanvas(32, 32);
    const shape: PolygonShapeParams = {
      kind: 'polygon', cx: 0, cy: 0,
      points: [{ x: 5, y: 25 }, { x: 15, y: 5 }, { x: 25, y: 25 }],
      color: '#000000', strokeWidth: 2, paintMode: 'stroke', cornerRadius: 8,
    };
    drawShape(canvas.getContext('2d') as unknown as CanvasRenderingContext2D, shape, false, { w: 32, h: 32 });
    expect(canvas.getContext('2d').getImageData(25, 25, 1, 1).data[3]).toBe(0);
    const pixels = canvas.getContext('2d').getImageData(0, 0, 32, 32).data;
    expect(Array.from(pixels).some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
  });
});
