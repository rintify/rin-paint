import {preciseCanvas,withCanvasOrigin} from '../geometry/canvasPrecision';
import {packRasterArchive, unpackRasterArchive} from './RasterArchive';
import { RasterTileResource } from './RasterTileResource';
import { IDENTITY, multiply, scaling, translation, inverse, transformBounds, type Homography } from '../geometry/homography';
import {drawProjectedProcedure} from '../geometry/drawProjectedProcedure';
import { SparseRaster, RASTER_TILE_SIZE, tileKey, type SparseRasterSnapshot } from './SparseRaster';
import type { RectMm } from '../geometry/homography';

const encodedSnapshots = new WeakMap<SparseRasterSnapshot, Blob>();
const size = RASTER_TILE_SIZE;
const canvas = (w: number, h: number): HTMLCanvasElement => {
  const result = document.createElement('canvas'); result.width = w; result.height = h; return result;
};

/** Pixel storage has no page boundary. Canvas objects exist only for bounded drawing requests. */
export class RasterSurface {
  private data: SparseRaster;
  private sourceKey: string | null = null;
  private source: (() => SparseRasterSnapshot | null) | null = null;
  private detached = false;
  private snapshotCache: SparseRasterSnapshot | null = null;
  private sourceSnapshot: SparseRasterSnapshot | null = null;

  bind(key: string, source: () => SparseRasterSnapshot | null): void {
    if (this.sourceKey === key) return;
    this.sourceKey = key; this.source = source; this.detached = false; this.sourceSnapshot = null;
  }
  unbind(): void {
    this.readData(); this.sourceKey = null; this.source = null; this.detached = false;
  }
  get contentDetached(): boolean { return this.detached; }
  private readData(): SparseRaster {
    const snapshot = this.source?.();
    if (snapshot && snapshot !== this.sourceSnapshot) {
      this.data = SparseRaster.from(snapshot); this.sourceSnapshot = snapshot; this.snapshotCache = snapshot;
    }
    return this.data;
  }
  private writable(): void {
    if (!this.source) return;
    this.readData(); this.source = null; this.detached = true;
  }
  constructor(ppi: number, snapshot?: SparseRasterSnapshot) {
    this.data = snapshot ? SparseRaster.from(snapshot) : new SparseRaster(ppi);
    this.snapshotCache = snapshot ?? null;
  }
  get intrinsicPpi(): number { return this.readData().intrinsicPpi; }
  get originMm(): {x: number; y: number} { return {...this.readData().originMm}; }
  get tileCount(): number { return this.readData().tileCount; }
  snapshot(): SparseRasterSnapshot { const data = this.readData(); return this.snapshotCache ??= data.snapshot(); }
  restore(snapshot: SparseRasterSnapshot): void { this.sourceKey = null; this.source = null; this.detached = false; this.snapshotCache = snapshot; this.sourceSnapshot = null; this.data = SparseRaster.from(snapshot); }
  bounds(): RectMm | null { return this.readData().contentBoundsPx(); }
  resample(ppi: number): void { this.writable(); this.data = this.data.resample(ppi); this.snapshotCache = null; }

  paint(region: RectMm, draw: (ctx: CanvasRenderingContext2D) => void): void {
    if (region.w <= 0 || region.h <= 0) return;
    if (![region.x, region.y, region.w, region.h].every(Number.isFinite)) throw new Error('描画範囲が不正です');
    this.writable();
    const tile = canvas(size, size), ctx = tile.getContext('2d', {willReadFrequently: true})!;
    const changes: import('./SparseRaster').RasterTileChange[] = [];
    for (let ty = Math.floor(region.y / size); ty < Math.ceil((region.y + region.h) / size); ty++) {
      for (let tx = Math.floor(region.x / size); tx < Math.ceil((region.x + region.w) / size); tx++) {
        const key = tileKey(tx, ty), previous = this.data.tile(key) ?? null;
        const previousPixels = previous?.pixels;
        ctx.resetTransform(); ctx.clearRect(0, 0, size, size);
        if (previousPixels) {const image = ctx.createImageData(size, size); image.data.set(previousPixels); ctx.putImageData(image, 0, 0);}
        ctx.save(); ctx.translate(-tx * size, -ty * size);
        draw(preciseCanvas(ctx)); ctx.restore();
        const pixels = ctx.getImageData(0, 0, size, size).data;
        if (previousPixels && pixels.every((value, index) => value === previousPixels[index])) continue;
        let opaque = false;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) {opaque = true; break;}
        if (!previous && !opaque) continue;
        changes.push({key, before: previous, after: opaque ? new RasterTileResource(crypto.randomUUID(), pixels) : null});
      }
    }
    this.data.apply(changes, 'after');
    if (changes.length) this.snapshotCache = null;
    tile.width = tile.height = 0;
  }

  clear(region?: RectMm): void {
    this.writable();
    if (!region) {this.data = new SparseRaster(this.intrinsicPpi, this.originMm); this.snapshotCache = null; return;}
    // Do not visit the transparent gaps between occupied tiles.
    for (const tile of [...this.data.occupied(region)]) {
      this.paint({x: tile.x, y: tile.y, w: size, h: size}, ctx => ctx.clearRect(region.x, region.y, region.w, region.h));
    }
  }
  drawTo(ctx: CanvasRenderingContext2D, region?: RectMm): void {
    if (!region) {
      const m = ctx.getTransform();
      const inv = inverse([m.a, m.c, m.e, m.b, m.d, m.f, 0, 0, 1]);
      if (!inv) return;
      region = transformBounds(inv, {x: 0, y: 0, w: ctx.canvas.width, h: ctx.canvas.height}) ?? undefined;
    }
    const tile = canvas(size, size), target = tile.getContext('2d')!;
    for (const occupied of this.readData().occupied(region)) {
      const image = target.createImageData(size, size); image.data.set(occupied.pixels); target.putImageData(image, 0, 0);
      withCanvasOrigin(ctx,occupied.x,occupied.y,()=>ctx.drawImage(tile,0,0));
    }
    tile.width = tile.height = 0;
  }
  /** Render native pixels in the destination's physical coordinate system. */
  drawAtPpi(ctx: CanvasRenderingContext2D, outputPpi: number, placement: Homography = IDENTITY): void {
    const origin = this.originMm;
    const matrix = multiply(scaling(outputPpi / 25.4), multiply(placement,
      multiply(translation(origin.x, origin.y), scaling(25.4 / this.intrinsicPpi))));
    if (Math.abs(matrix[6]) < 1e-12 && Math.abs(matrix[7]) < 1e-12) {
      const m = matrix.map(value => value / matrix[8]);
      ctx.save(); ctx.transform(m[0], m[3], m[1], m[4], m[2], m[5]); this.drawTo(ctx); ctx.restore();
      return;
    }
    const bounds=this.bounds();if(!bounds)return;
    drawProjectedProcedure(ctx,bounds,matrix,source=>this.drawTo(source));
  }

  read(region: RectMm): HTMLCanvasElement {
    const result = canvas(region.w, region.h), ctx = result.getContext('2d')!;
    ctx.translate(-region.x, -region.y); this.drawTo(ctx, region); return result;
  }
  imageData(region: RectMm): ImageData {
    return this.read(region).getContext('2d')!.getImageData(0, 0, region.w, region.h);
  }
  putImageData(image: ImageData, x: number, y: number): void {
    const source = canvas(image.width, image.height); source.getContext('2d')!.putImageData(image, 0, 0);
    this.paint({x, y, w: image.width, h: image.height}, ctx => {ctx.clearRect(x, y, image.width, image.height); ctx.drawImage(source, x, y);});
  }
  async encode(): Promise<Blob> {
    const snapshot = this.snapshot(), cached = encodedSnapshots.get(snapshot);
    if (cached) return cached;
    const blob = packRasterArchive({ppi:snapshot.intrinsicPpi,origin:snapshot.originMm,
      tiles:[...snapshot.tiles].map(([key,tile])=>({key,id:tile.id,blob:RasterTileResource.from(tile).blob,bounds:RasterTileResource.from(tile).boundsPx}))});
    encodedSnapshots.set(snapshot,blob); return blob;
  }
  static async decode(blob: Blob): Promise<RasterSurface> {
    const archive = await unpackRasterArchive(blob);
    const tiles = new Map(await Promise.all(archive.tiles.map(async tile => [tile.key,await RasterTileResource.decode(tile.id,tile.blob,tile.bounds)] as const)));
    const snapshot = {intrinsicPpi:archive.ppi,originMm:archive.origin,tiles};
    encodedSnapshots.set(snapshot,blob);
    return new RasterSurface(archive.ppi,snapshot);
  }
}
