import {describe, expect, it} from 'vitest';
import {RasterTileResource} from './RasterTileResource';

describe('compressed live raster tiles', () => {
  it('retains sparse RGBA exactly after decoded cache eviction without retaining caller pixels', () => {
    const pixels = new Uint8ClampedArray(256 * 256 * 4);
    pixels.set([12, 34, 56, 78], 1024);
    const resource = new RasterTileResource('sparse', pixels);
    const expected = pixels.slice();
    pixels.fill(255);
    expect(resource.encodedBytes).toBeLessThan(100);
    RasterTileResource.clearDecoded();
    expect(resource.pixels).toEqual(expected);
    expect(RasterTileResource.from(resource)).toBe(resource);
  });
  it('roundtrips literal blocks, long runs, and nonaligned pixel buffers', () => {
    const storage = new Uint8ClampedArray(256 * 256 * 4 + 1);
    const pixels = storage.subarray(1);
    let random = 17;
    for (let i = 0; i < pixels.length; i++) {random = Math.imul(random, 1664525) + 1013904223 | 0; pixels[i] = random >>> 24;}
    pixels.fill(13, 4000, 9000);
    const resource = new RasterTileResource('mixed', pixels);
    RasterTileResource.clearDecoded();
    expect(resource.pixels).toEqual(pixels);
  });
});
