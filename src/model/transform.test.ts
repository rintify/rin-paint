import { describe, expect, it } from 'vitest';
import { composeHomography, homographyFromQuads, invertHomography, multiplyHomography, transformPoint, transformedBounds } from './transform';

describe('homography', () => {
  it('round-trips a projective point', () => {
    const matrix = composeHomography({ translateXmm: 12, translateYmm: -4, rotationDeg: 23, scaleX: 1.4, scaleY: .8, shearXDeg: 8, perspectiveX: .001 });
    const inverse = invertHomography(matrix)!;
    const source = { x: -8, y: 19 };
    const projected = transformPoint(matrix, source)!;
    const restored = transformPoint(inverse, projected)!;
    expect(restored.x).toBeCloseTo(source.x, 8);
    expect(restored.y).toBeCloseTo(source.y, 8);
    const identity = multiplyHomography(matrix, inverse);
    expect(identity[0]).toBeCloseTo(1, 8);
    expect(identity[4]).toBeCloseTo(1, 8);
    expect(identity[8]).toBeCloseTo(1, 8);
  });

  it('rejects singular matrices and calculates inverse request bounds', () => {
    expect(invertHomography([1, 0, 0, 0, 0, 0, 0, 0, 1])).toBeNull();
    expect(transformedBounds(composeHomography({ translateXmm: -10 }), { x: 0, y: 0, w: 20, h: 30 }))
      .toEqual({ x: -10, y: 0, w: 20, h: 30 });
  });

  it('maps all four corners with an exact projective transform', () => {
    const source = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }];
    const target = [{ x: 12, y: -4 }, { x: 125, y: 9 }, { x: 92, y: 101 }, { x: -17, y: 66 }];
    const matrix = homographyFromQuads(source, target)!;
    source.forEach((point, index) => {
      const mapped = transformPoint(matrix, point)!;
      expect(mapped.x).toBeCloseTo(target[index].x, 8);
      expect(mapped.y).toBeCloseTo(target[index].y, 8);
    });
  });

  it('rejects a degenerate source quad', () => {
    const line = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
    const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(homographyFromQuads(line, square)).toBeNull();
  });
});
