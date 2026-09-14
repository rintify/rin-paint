import { describe, expect, it } from 'vitest';
import { outlineSquaredDistances } from './outlineDistance';

describe('outline squared distances', () => {
  it.each([0, 127.5, 255])('matches nearest-seed distances at threshold %s', (threshold) => {
    for (const [width, height] of [[1, 9], [11, 1], [13, 7]]) {
      const sourceWidth = width + 4;
      const pixels = new Uint8ClampedArray(sourceWidth * (height + 4) * 4);
      const seeds: Array<[number, number]> = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const alpha = [0, 64, 127, 128, 255][(x * 7 + y * 11) % 5];
          pixels[((y + 2) * sourceWidth + x + 2) * 4 + 3] = alpha;
          if (alpha > 0 && alpha >= threshold) seeds.push([x, y]);
        }
      }
      const actual = outlineSquaredDistances(pixels, sourceWidth, 2, 2, width, height, threshold);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          expect(actual[y * width + x]).toBe(Math.min(...seeds.map(([sx, sy]) => (x - sx) ** 2 + (y - sy) ** 2)));
    }
  });

  it('handles empty rows, holes, and a seed at the far edge', () => {
    const width = 17, height = 9;
    for (const seeds of [[[16, 8]], [[0, 0], [16, 8]], [[8, 4], [7, 4], [9, 4]]]) {
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (const [x, y] of seeds) pixels[(y * width + x) * 4 + 3] = 255;
      const actual = outlineSquaredDistances(pixels, width, 0, 0, width, height, 128);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          expect(actual[y * width + x]).toBe(Math.min(...seeds.map(([sx, sy]) => (x - sx) ** 2 + (y - sy) ** 2)));
    }
  });

  it('keeps opaque interiors zero and transparent input unbounded', () => {
    const pixels = new Uint8ClampedArray(48 * 4);
    expect([...outlineSquaredDistances(pixels, 8, 0, 0, 8, 6, 0)].every(value => value >= 1e19)).toBe(true);
    pixels.fill(255);
    expect([...outlineSquaredDistances(pixels, 8, 0, 0, 8, 6, 128)]).toEqual(Array(48).fill(0));
  });
});
