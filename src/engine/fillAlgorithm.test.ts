import { describe, expect, it } from 'vitest';
import { analyzeFill } from './fillAlgorithm';

function pixels(rows: string[]): Uint8ClampedArray {
  const colors: Record<string, [number, number, number, number]> = {
    W: [255, 255, 255, 255],
    K: [0, 0, 0, 255],
    G: [230, 230, 230, 255],
  };
  return new Uint8ClampedArray(rows.flatMap(row => [...row].flatMap(char => colors[char])));
}

describe('fill analysis', () => {
  it('uses a fixed OKLab seed color and four-way connectivity', () => {
    const data = pixels(['WKW', 'KWK', 'WKW']);
    const result = analyzeFill({ pixels: data, width: 3, height: 3, seedX: 0, seedY: 0, tolerance: 0, gapClosePx: 0 });
    expect([...result.mask]).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('includes perceptually close colors only when tolerance allows them', () => {
    const data = pixels(['WG']);
    expect([...analyzeFill({ pixels: data, width: 2, height: 1, seedX: 0, seedY: 0, tolerance: 0, gapClosePx: 0 }).mask]).toEqual([1, 0]);
    expect([...analyzeFill({ pixels: data, width: 2, height: 1, seedX: 0, seedY: 0, tolerance: 20, gapClosePx: 0 }).mask]).toEqual([1, 1]);
  });

  it('closes a one-pixel boundary opening virtually without filling the closure pixel', () => {
    const rows = [
      'WWWWWWW',
      'WKKWKKW',
      'WKWWWKW',
      'WKWWWKW',
      'WKWWWKW',
      'WKKKKKW',
      'WWWWWWW',
    ];
    const data = pixels(rows);
    const open = analyzeFill({ pixels: data, width: 7, height: 7, seedX: 3, seedY: 3, tolerance: 0, gapClosePx: 0 });
    const closed = analyzeFill({ pixels: data, width: 7, height: 7, seedX: 3, seedY: 3, tolerance: 0, gapClosePx: 1 });
    expect(open.mask[0]).toBe(1);
    expect(closed.mask[0]).toBe(0);
    expect(closed.mask[1 * 7 + 3]).toBe(0);
    expect(closed.mask[3 * 7 + 3]).toBe(1);
  });

  it('does not close an opening wider than the configured level', () => {
    const rows = [
      'WWWWWWWW',
      'WKKWWKKW',
      'WKWWWWKW',
      'WKWWWWKW',
      'WKWWWWKW',
      'WKKKKKKW',
      'WWWWWWWW',
    ];
    const data = pixels(rows);
    const levelOne = analyzeFill({ pixels: data, width: 8, height: 7, seedX: 3, seedY: 3, tolerance: 0, gapClosePx: 1 });
    const levelTwo = analyzeFill({ pixels: data, width: 8, height: 7, seedX: 3, seedY: 3, tolerance: 0, gapClosePx: 2 });
    expect(levelOne.mask[0]).toBe(1);
    expect(levelTwo.mask[0]).toBe(0);
  });
});
