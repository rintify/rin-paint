import { describe, expect, it } from 'vitest';
import { SparseAlphaTiles } from './SparseAlphaTiles';
import { TILE_SIZE } from './geometry';

describe('sparse alpha contour cells', () => {
  it('visits only the perimeter of an opaque tile', () => {
    const tiles = new SparseAlphaTiles();
    const rgba = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4).fill(255);
    tiles.setRgba(0, 0, rgba);
    const cells = [...tiles.boundaryCells(127.5)];
    expect(cells).toHaveLength(TILE_SIZE * 4);
    expect(cells.every(({ x, y }) => x === 0 || y === 0 || x === TILE_SIZE || y === TILE_SIZE)).toBe(true);
  });

  it.each([0, 127.5, 255])('matches a pixel-by-pixel scan across negative tile seams at threshold %s', limit => {
    const tiles = new SparseAlphaTiles();
    const sources = new Map<string, number>();
    for (const tx of [-1, 0]) {
      for (const ty of [-1, 0]) {
        const rgba = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
        for (let y = -3; y <= 3; y++) {
          for (let x = -3; x <= 3; x++) {
            if (Math.floor(x / TILE_SIZE) !== tx || Math.floor(y / TILE_SIZE) !== ty) continue;
            const alpha = [0, 64, 128, 255][Math.abs(x * 7 + y * 11) % 4];
            rgba[((y - ty * TILE_SIZE) * TILE_SIZE + x - tx * TILE_SIZE) * 4 + 3] = alpha;
            sources.set(`${x},${y}`, alpha);
          }
        }
        tiles.setRgba(tx, ty, rgba);
      }
    }
    const expected: string[] = [];
    const inside = (x: number, y: number) => (sources.get(`${x - 1},${y - 1}`) ?? 0) >= Math.max(0.5, limit);
    for (let y = -4; y <= 5; y++) {
      for (let x = -4; x <= 5; x++) {
        const values = [inside(x, y), inside(x + 1, y), inside(x + 1, y + 1), inside(x, y + 1)];
        if (values.some(value => value !== values[0])) expected.push(`${x},${y}`);
      }
    }
    expect([...tiles.boundaryCells(limit)].map(({ x, y }) => `${x},${y}`).sort()).toEqual(expected.sort());
  });

  it('does not scan the empty gap between remote tiles or retain cleared tiles', () => {
    const tiles = new SparseAlphaTiles();
    const rgba = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
    rgba[3] = 255;
    tiles.setRgba(-1000, 0, rgba);
    tiles.setRgba(1000, 0, rgba);
    expect([...tiles.boundaryCells(128)]).toHaveLength(8);
    rgba.fill(0);
    tiles.setRgba(-1000, 0, rgba);
    expect([...tiles.boundaryCells(128)]).toHaveLength(4);
  });
});
