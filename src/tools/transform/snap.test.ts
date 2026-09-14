import { describe, expect, it } from 'vitest';
import { snapUniformScale, pointBounds } from './snap';

describe('uniform transform snapping', () => {
  const lines = { x: [{ value: 100, rank: 0 }], y: [] };
  it('reaches a guide without changing the center or aspect ratio', () => {
    expect(snapUniformScale({ x: 80, y: 60 }, { x: 40, y: 40 }, 1.45, lines, 8))
      .toEqual({ scale: 1.5, xGuide: 100, yGuide: null });
  });
  it('does not snap beyond the screen tolerance or permitted scale range', () => {
    expect(snapUniformScale({ x: 80, y: 60 }, { x: 40, y: 40 }, 1.2, lines, 8).scale).toBe(1.2);
    expect(snapUniformScale({ x: 41, y: 41 }, { x: 40, y: 40 }, 20, lines, 100).scale).toBe(20);
  });
  it('does not divide by zero on an axis aligned corner', () => {
    expect(snapUniformScale({ x: 40, y: 60 }, { x: 40, y: 40 }, 1, lines, 8))
      .toEqual({ scale: 1, xGuide: null, yGuide: null });
  });
  it('uses the enclosing bounds of a rotated or deformed frame', () => {
    expect(pointBounds([{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 20 }]))
      .toEqual({ x: 0, y: 0, w: 20, h: 20 });
  });
});
