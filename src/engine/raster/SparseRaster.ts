import type { PointMm, RectMm } from '../geometry/homography';

export const RASTER_TILE_SIZE = 256;
export type TileKey = `${number},${number}`;
export interface RasterTile { readonly id: string; readonly pixels: Uint8ClampedArray }
export interface RasterTileChange { key: TileKey; before: RasterTile | null; after: RasterTile | null }
export interface SparseRasterSnapshot {
  readonly intrinsicPpi: number;
  readonly originMm: PointMm;
  readonly tiles: ReadonlyMap<TileKey, RasterTile>;
}
export const tileKey = (x: number, y: number): TileKey => `${x},${y}`;
export const tileCoordinates = (key: TileKey): [number, number] => key.split(',').map(Number) as [number, number];
const tileBytes = RASTER_TILE_SIZE * RASTER_TILE_SIZE * 4;
const transparent = (data: Uint8ClampedArray) => {
  for (let i = 3; i < data.length; i += 4) if (data[i]) return false;
  return true;
};

/** Sparse, immutable committed tiles. Editing a snapshot copies touched tiles only. */
export class SparseRaster {
  private tiles = new Map<TileKey, RasterTile>();
  private pending: Map<TileKey, { before: RasterTile | null; pixels: Uint8ClampedArray }> | null = null;
  constructor(public intrinsicPpi: number, public originMm: PointMm = { x: 0, y: 0 }) {
    if (!Number.isFinite(intrinsicPpi) || intrinsicPpi <= 0) throw new Error('ラスターのPPIが不正です');
  }
  get tileCount(): number { return this.tiles.size; }
  get byteLength(): number { return this.tiles.size * tileBytes; }
  snapshot(): SparseRasterSnapshot {
    if (this.pending) throw new Error('編集を確定してから保存してください');
    return { intrinsicPpi: this.intrinsicPpi, originMm: { ...this.originMm }, tiles: new Map(this.tiles) };
  }
  static from(snapshot: SparseRasterSnapshot): SparseRaster {
    const raster = new SparseRaster(snapshot.intrinsicPpi, { ...snapshot.originMm });
    raster.tiles = new Map(snapshot.tiles);
    return raster;
  }
  begin(): void {
    if (this.pending) throw new Error('ラスターの編集がすでに開始されています');
    this.pending = new Map();
  }
  private writable(key: TileKey): Uint8ClampedArray {
    if (!this.pending) throw new Error('ラスターの編集が開始されていません');
    let entry = this.pending.get(key);
    if (!entry) {
      const before = this.tiles.get(key) ?? null;
      entry = { before, pixels: before ? before.pixels.slice() : new Uint8ClampedArray(tileBytes) };
      this.pending.set(key, entry);
    }
    return entry.pixels;
  }
  pixel(x: number, y: number): readonly [number, number, number, number] {
    x = Math.floor(x); y = Math.floor(y);
    const tx = Math.floor(x / RASTER_TILE_SIZE), ty = Math.floor(y / RASTER_TILE_SIZE);
    const key = tileKey(tx, ty), data = this.pending?.get(key)?.pixels ?? this.tiles.get(key)?.pixels;
    if (!data) return [0, 0, 0, 0];
    const offset = ((y - ty * RASTER_TILE_SIZE) * RASTER_TILE_SIZE + x - tx * RASTER_TILE_SIZE) * 4;
    return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
  }
  writePixel(x: number, y: number, rgba: readonly number[]): void {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new Error('画素座標が不正です');
    const tx = Math.floor(x / RASTER_TILE_SIZE), ty = Math.floor(y / RASTER_TILE_SIZE);
    const data = this.writable(tileKey(tx, ty));
    const offset = ((y - ty * RASTER_TILE_SIZE) * RASTER_TILE_SIZE + x - tx * RASTER_TILE_SIZE) * 4;
    for (let i = 0; i < 4; i++) data[offset + i] = rgba[i] ?? 0;
  }
  /** Visits occupied tiles only, including for a request covering a vast empty coordinate range. */
  *occupied(region?: RectMm): IterableIterator<{ key: TileKey; x: number; y: number; pixels: Uint8ClampedArray }> {
    const keys = new Set([...this.tiles.keys(), ...(this.pending?.keys() ?? [])]);
    for (const key of keys) {
      const [tx, ty] = tileCoordinates(key), x = tx * RASTER_TILE_SIZE, y = ty * RASTER_TILE_SIZE;
      if (region && (x >= region.x + region.w || y >= region.y + region.h || x + RASTER_TILE_SIZE <= region.x || y + RASTER_TILE_SIZE <= region.y)) continue;
      yield { key, x, y, pixels: this.pending?.get(key)?.pixels ?? this.tiles.get(key)!.pixels };
    }
  }
  commit(): RasterTileChange[] {
    if (!this.pending) return [];
    const changes: RasterTileChange[] = [];
    for (const [key, { before, pixels }] of this.pending) {
      if (before && pixels.every((v, i) => v === before.pixels[i])) continue;
      const after = transparent(pixels) ? null : { id: crypto.randomUUID(), pixels };
      if (!before && !after) continue;
      if (after) this.tiles.set(key, after); else this.tiles.delete(key);
      changes.push({ key, before, after });
    }
    this.pending = null;
    return changes;
  }
  cancel(): void { this.pending = null; }
  apply(changes: readonly RasterTileChange[], side: 'before' | 'after'): void {
    if (this.pending) throw new Error('編集中に履歴を適用できません');
    for (const change of changes) {
      const tile = change[side];
      if (tile) this.tiles.set(change.key, tile); else this.tiles.delete(change.key);
    }
  }
  contentBoundsPx(): RectMm | null {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const tile of this.occupied()) {
      for (let y = 0; y < RASTER_TILE_SIZE; y++) for (let x = 0; x < RASTER_TILE_SIZE; x++) {
        if (!tile.pixels[(y * RASTER_TILE_SIZE + x) * 4 + 3]) continue;
        x0 = Math.min(x0, tile.x + x); y0 = Math.min(y0, tile.y + y);
        x1 = Math.max(x1, tile.x + x + 1); y1 = Math.max(y1, tile.y + y + 1);
      }
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1-x0, h: y1-y0 };
  }
  contentBoundsMm(): RectMm | null {
    const rect = this.contentBoundsPx(), mm = 25.4 / this.intrinsicPpi;
    return rect ? { x: this.originMm.x + rect.x * mm, y: this.originMm.y + rect.y * mm, w: rect.w * mm, h: rect.h * mm } : null;
  }
  /** Bilinear sampling in premultiplied alpha, avoiding dark seams around transparent pixels. */
  sample(x: number, y: number): readonly [number, number, number, number] {
    const x0 = Math.floor(x), y0 = Math.floor(y), dx = x-x0, dy = y-y0;
    const weights = [(1-dx)*(1-dy), dx*(1-dy), (1-dx)*dy, dx*dy];
    const pixels = [this.pixel(x0,y0),this.pixel(x0+1,y0),this.pixel(x0,y0+1),this.pixel(x0+1,y0+1)];
    const out = [0,0,0,0];
    for (let i=0;i<4;i++) {
      const alpha = pixels[i][3] / 255 * weights[i];
      for (let channel=0;channel<3;channel++) out[channel] += pixels[i][channel] * alpha;
      out[3] += alpha;
    }
    return out[3] ? [out[0]/out[3],out[1]/out[3],out[2]/out[3],out[3]*255] : [0,0,0,0];
  }
  resample(ppi: number): SparseRaster {
    const result = new SparseRaster(ppi, { ...this.originMm });
    const factor = ppi / this.intrinsicPpi;
    const destinations = new Set<TileKey>();
    for (const tile of this.occupied()) {
      const minX = Math.floor((tile.x-1)*factor/RASTER_TILE_SIZE), minY = Math.floor((tile.y-1)*factor/RASTER_TILE_SIZE);
      const maxX = Math.ceil((tile.x+RASTER_TILE_SIZE+1)*factor/RASTER_TILE_SIZE), maxY = Math.ceil((tile.y+RASTER_TILE_SIZE+1)*factor/RASTER_TILE_SIZE);
      for(let y=minY;y<maxY;y++) for(let x=minX;x<maxX;x++) destinations.add(tileKey(x,y));
    }
    result.begin();
    for (const key of destinations) {
      const [tx,ty] = tileCoordinates(key);
      for(let y=0;y<RASTER_TILE_SIZE;y++) for(let x=0;x<RASTER_TILE_SIZE;x++) {
        const px=tx*RASTER_TILE_SIZE+x, py=ty*RASTER_TILE_SIZE+y;
        const sample=this.sample((px+.5)/factor-.5,(py+.5)/factor-.5);
        if(sample[3] >= .5) result.writePixel(px,py,sample);
      }
    }
    result.commit();
    return result;
  }
}
