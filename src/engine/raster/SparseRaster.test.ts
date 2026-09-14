import { describe, expect, it } from 'vitest';
import { SparseRaster } from './SparseRaster';

describe('sparse physical raster', () => {
  it('stores distant positive and negative pixels without the space between them', () => {
    const raster = new SparseRaster(300);
    raster.begin(); raster.writePixel(-1000001,-2,[255,0,0,255]); raster.writePixel(1000001,2,[0,0,255,255]);
    const patch = raster.commit();
    expect(raster.tileCount).toBe(2); expect(patch).toHaveLength(2);
    expect(raster.pixel(-1000001,-2)).toEqual([255,0,0,255]);
    expect([...raster.occupied({x:-10,y:-10,w:20,h:20})]).toHaveLength(0);
    raster.apply(patch,'before'); expect(raster.tileCount).toBe(0);
    raster.apply(patch,'after'); expect(raster.tileCount).toBe(2);
  });
  it('detaches content as a whole while copying only changed tiles', () => {
    const source = new SparseRaster(300);
    source.begin(); source.writePixel(1,1,[1,2,3,255]); source.writePixel(257,1,[4,5,6,255]); source.commit();
    const fork = SparseRaster.from(source.snapshot());
    fork.begin(); fork.writePixel(1,1,[9,9,9,255]); fork.commit();
    expect(fork.snapshot().tiles.get('1,0')).toBe(source.snapshot().tiles.get('1,0'));
    source.begin(); source.writePixel(300,1,[7,8,9,255]); source.commit();
    expect(fork.pixel(300,1)[3]).toBe(0); expect(source.pixel(1,1)).toEqual([1,2,3,255]);
  });
  it('reclaims transparent tiles and cancels staged writes', () => {
    const raster = new SparseRaster(300);
    raster.begin(); raster.writePixel(-1,-1,[0,0,0,255]); raster.commit();
    raster.begin(); raster.writePixel(-1,-1,[0,0,0,0]); raster.cancel();
    expect(raster.pixel(-1,-1)[3]).toBe(255);
    raster.begin(); raster.writePixel(-1,-1,[0,0,0,0]); raster.commit();
    expect(raster.tileCount).toBe(0);
  });
  it('resamples off-page data without changing the physical origin or source', () => {
    const raster = new SparseRaster(100,{x:5,y:-8});
    raster.begin(); raster.writePixel(-10,2,[255,0,0,255]); raster.commit();
    const scaled = raster.resample(200);
    expect(scaled.originMm).toEqual(raster.originMm); expect(scaled.pixel(-20,4)[3]).toBeGreaterThan(0);
    expect(raster.intrinsicPpi).toBe(100); expect(raster.pixel(-10,2)[3]).toBe(255);
  });
});
