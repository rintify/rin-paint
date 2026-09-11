import { describe, expect, it } from 'vitest';
import { shapeBounds, shapeFromDrag, translateShape } from './index';

const p = (x: number, y: number) => ({ x, y, pressure: 1 });

describe('shape geometry', () => {
  it('normalizes rectangle and ellipse drags', () => {
    expect(shapeFromDrag('rect', p(10, 20), p(2, 5), '#000', 4)).toMatchObject({ x: 2, y: 5, width: 8, height: 15 });
    expect(shapeFromDrag('ellipse', p(10, 20), p(2, 4), '#000', 4)).toMatchObject({ cx: 6, cy: 12, rx: 4, ry: 8 });
  });

  it('rejects zero-sized shapes', () => {
    expect(shapeFromDrag('line', p(1, 1), p(1, 1), '#000', 1)).toBeNull();
    expect(shapeFromDrag('rect', p(1, 1), p(2, 1), '#000', 1)).toBeNull();
  });

  it('moves every geometry without changing its size', () => {
    const line = shapeFromDrag('line', p(1, 2), p(4, 6), '#000', 2)!;
    expect(translateShape(line, 3, -1)).toMatchObject({ x1: 4, y1: 1, x2: 7, y2: 5 });
    expect(shapeBounds(translateShape(line, 3, -1))).toEqual({ x: 4, y: 1, w: 3, h: 4 });
  });
});
