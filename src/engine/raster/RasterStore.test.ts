import { describe, expect, it } from 'vitest';
import { SparseRaster } from './SparseRaster';
import { RasterStore } from './RasterStore';
import { ByteLru } from './ByteLru';

describe('immutable raster resources', () => {
  it('roundtrips distant signed tiles, deduplicates shared history resources, and only collects unreachable revisions', async () => {
    const raster = new SparseRaster(300,{x:10,y:-20});
    raster.begin(); raster.writePixel(-1000000,0,[255,0,0,255]); raster.writePixel(1000000,0,[0,0,255,255]); raster.commit();
    const store = new RasterStore(256*256*4);
    const before = await store.commit(raster.snapshot());
    raster.begin(); raster.writePixel(-1000000,0,[0,255,0,255]); raster.commit();
    const after = await store.commit(raster.snapshot());
    const archive = store.archive([before,after]);
    expect(archive.resources).toHaveLength(3);
    const restored = new RasterStore(0); restored.load(archive);
    const old = SparseRaster.from(await restored.snapshot(before));
    expect(old.pixel(-1000000,0)).toEqual([255,0,0,255]);
    expect(old.pixel(1000000,0)).toEqual([0,0,255,255]);
    expect(old.originMm).toEqual({x:10,y:-20});
    expect(restored.decodedBytes).toBe(0);
    restored.collect([after]);
    expect(restored.resourceCount).toBe(2);
    expect(() => restored.revision(before)).toThrow();
  });

  it('evicts the least recently used resource by bytes and refuses oversized entries', () => {
    const cache = new ByteLru<string,string>(10);
    cache.set('a','a',4); cache.set('b','b',4); cache.get('a'); cache.set('c','c',4);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('a');
    expect(cache.set('large','large',11)).toBe(false);
    expect(cache.byteLength).toBe(8);
  });
});
