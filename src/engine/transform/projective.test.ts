import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANSFORM } from '../../model/transform';
import { inverseMatrix, mapPoint, transformMatrix } from './projective';
describe('projective transform', () => {
  it('combines translation, rotation, scale, shear and perspective with an exact inverse', () => {
    const m = transformMatrix(
      {
        ...DEFAULT_TRANSFORM,
        translateX: 20,
        translateY: -5,
        rotation: 35,
        scaleX: 130,
        scaleY: 70,
        shear: 25,
        perspectiveX: 40,
        perspectiveY: -20,
      },
      200,
      100,
    );
    const inverse = inverseMatrix(m)!;
    for (const [x, y] of [
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
      [65, 23],
    ]) {
      const p = mapPoint(m, x, y),
        original = mapPoint(inverse, p.x, p.y);
      expect(original.x).toBeCloseTo(x, 8);
      expect(original.y).toBeCloseTo(y, 8);
    }
    const a = mapPoint(m, 0, 20),
      b = mapPoint(m, 100, 20),
      c = mapPoint(m, 200, 20);
    expect((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)).toBeCloseTo(
      0,
      8,
    );
  });
  it('treats zero scale as a collapsed image', () => {
    expect(
      inverseMatrix(
        transformMatrix({ ...DEFAULT_TRANSFORM, scaleX: 0 }, 100, 100),
      ),
    ).toBeNull();
  });
});
