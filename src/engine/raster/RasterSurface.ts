import {
  createAsset,
  publishAsset,
  decodeAsset,
  getAsset,
  rasterStats,
  type RasterAsset,
  type StoredRasterContent,
} from './RasterAssetRepository';
import { drawTransformedRegion } from './drawTransformedRegion';
import {
  intersect,
  rasterCanvas,
  tileCoordinates,
  tileKey,
  tileRect,
  TILE_SIZE,
  union,
  validateRect,
  yieldRaster,
  type PixelRect,
  type TileKey,
} from './geometry';
export interface ReadonlyRasterTile {
  tx: number;
  ty: number;
  asset: RasterAsset;
}
export interface RasterTilePatch {
  tx: number;
  ty: number;
  before: string | null;
  after: string | null;
}
export interface RasterChangeSet {
  tiles: RasterTilePatch[];
}
export function alphaBounds(canvas: HTMLCanvasElement): PixelRect | null {
  const { data } = canvas
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, canvas.width, canvas.height);
  let x0 = canvas.width,
    y0 = canvas.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0, i = 3; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++, i += 4) {
      if (data[i]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
const knownBounds = new WeakMap<RasterAsset, PixelRect | null>();

export class RasterSurface {
  private tiles = new Map<TileKey, ReadonlyRasterTile>();
  get tileCount(): number {
    return this.tiles.size;
  }
  entries(): Iterable<ReadonlyRasterTile> {
    return this.tiles.values();
  }
  get(tx: number, ty: number): RasterAsset | null {
    return this.tiles.get(tileKey(tx, ty))?.asset ?? null;
  }
  set(tx: number, ty: number, asset: RasterAsset | null): void {
    validateRect(tileRect(tx, ty));
    if (asset) this.tiles.set(tileKey(tx, ty), { tx, ty, asset });
    else this.tiles.delete(tileKey(tx, ty));
  }
  clone(): RasterSurface {
    const copy = new RasterSurface();
    copy.tiles = new Map(this.tiles);
    return copy;
  }
  getContentBounds(): PixelRect | null {
    let result: PixelRect | null = null;
    for (const { tx, ty, asset } of this.tiles.values())
      result = union(result, {
        ...asset.bounds,
        x: tx * TILE_SIZE + asset.bounds.x,
        y: ty * TILE_SIZE + asset.bounds.y,
      });
    return result;
  }
  *queryTiles(rect: PixelRect): Generator<ReadonlyRasterTile> {
    validateRect(rect);
    const count =
      (Math.ceil((rect.x + rect.w) / TILE_SIZE) -
        Math.floor(rect.x / TILE_SIZE)) *
      (Math.ceil((rect.y + rect.h) / TILE_SIZE) -
        Math.floor(rect.y / TILE_SIZE));
    if (count < this.tiles.size) {
      for (const { tx, ty } of tileCoordinates(rect)) {
        const tile = this.tiles.get(tileKey(tx, ty));
        if (tile) yield tile;
      }
    } else
      for (const tile of this.tiles.values())
        if (intersect(rect, tileRect(tile.tx, tile.ty))) yield tile;
  }
  drawRegion(ctx: CanvasRenderingContext2D, rect: PixelRect): void {
    validateRect(rect);
    ctx.save();
    try {
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      const m = ctx.getTransform();
      if (
        m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 &&
        Number.isInteger(m.e) && Number.isInteger(m.f)
      )
        this.drawTiles(ctx, rect);
      else
        drawTransformedRegion(ctx, rect, (target, input) =>
          this.drawTiles(target, input),
        );
    } finally {
      ctx.restore();
    }
  }

  private drawTiles(ctx: CanvasRenderingContext2D, rect: PixelRect): void {
    ctx.save();
    try {
      // Keep bitmap coordinates local for content far from the world origin.
      ctx.translate(rect.x, rect.y);
      for (const { tx, ty, asset } of this.queryTiles(rect)) {
        if (!asset.canvas)
          throw new Error('画像タイルの読込が完了していません');
        ctx.drawImage(
          asset.canvas,
          tx * TILE_SIZE - rect.x,
          ty * TILE_SIZE - rect.y,
        );
      }
    } finally {
      ctx.restore();
    }
  }

  readRegion(rect: PixelRect): ImageData {
    validateRect(rect);
    const c = rasterCanvas(rect.w, rect.h);
    rasterStats.maxTemporaryPixels = Math.max(
      rasterStats.maxTemporaryPixels,
      rect.w * rect.h,
    );
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.translate(-rect.x, -rect.y);
    this.drawRegion(ctx, rect);
    return ctx.getImageData(0, 0, rect.w, rect.h);
  }
  snapshot(): StoredRasterContent {
    for (const t of this.tiles.values()) publishAsset(t.asset);
    return {
      kind: 'raster-tiles',
      tileSize: TILE_SIZE,
      tiles: [...this.tiles.values()].map(({ tx, ty, asset }) => ({
        tx,
        ty,
        assetId: asset.id,
      })),
    };
  }
  static async restore(content: StoredRasterContent): Promise<RasterSurface> {
    const surface = new RasterSurface();
    const seen = new Set<TileKey>();
    if (content.kind !== 'raster-tiles' || content.tileSize !== TILE_SIZE)
      throw new Error('ラスター形式が不正です');
    for (const item of content.tiles) {
      if (
        !Number.isInteger(item.tx) ||
        !Number.isInteger(item.ty) ||
        seen.has(tileKey(item.tx, item.ty))
      )
        throw new Error('タイル座標が不正です');
      validateRect(tileRect(item.tx, item.ty));
      seen.add(tileKey(item.tx, item.ty));
    }
    for (let i = 0; i < content.tiles.length; i += 4) {
      const batch = content.tiles.slice(i, i + 4);
      const assets = await Promise.all(
        batch.map((item) => decodeAsset(item.assetId)),
      );
      batch.forEach((item, n) => {
        const asset = assets[n];
        if (!knownBounds.has(asset))
          knownBounds.set(asset, alphaBounds(asset.canvas!));
        const bounds = knownBounds.get(asset)!;
        if (bounds) {
          asset.bounds = bounds;
          surface.set(item.tx, item.ty, asset);
        }
      });
      if (i + 4 < content.tiles.length) await yieldRaster();
    }
    return surface;
  }
  async apply(
    patches: RasterTilePatch[],
    side: 'before' | 'after',
  ): Promise<void> {
    for (const p of patches) {
      if (!Number.isInteger(p.tx) || !Number.isInteger(p.ty))
        throw new Error('タイル座標が不正です');
      validateRect(tileRect(p.tx, p.ty));
    }
    const ready = await Promise.all(
      patches.map((p) => (p[side] ? decodeAsset(p[side]!) : null)),
    );
    patches.forEach((p, i) => this.set(p.tx, p.ty, ready[i]));
  }
}
export class RasterEditSession {
  private before = new Map<
    TileKey,
    { tx: number; ty: number; asset: RasterAsset | null }
  >();
  private writable = new Set<TileKey>();
  constructor(readonly surface: RasterSurface) {}
  /** Remove an occupied tile while retaining its immutable version for cancellation/history. */
  removeTile(tx: number, ty: number): void {
    validateRect(tileRect(tx, ty));
    const key = tileKey(tx, ty);
    if (!this.before.has(key))
      this.before.set(key, { tx, ty, asset: this.surface.get(tx, ty) });
    this.surface.set(tx, ty, null);
    this.writable.delete(key);
  }
  mutateRegion(
    rect: PixelRect,
    draw: (ctx: CanvasRenderingContext2D, tileRect: PixelRect) => void,
    existingOnly = false,
  ): void {
    validateRect(rect);
    const candidates = existingOnly
      ? [...this.surface.queryTiles(rect)].map((t) => ({ tx: t.tx, ty: t.ty }))
      : tileCoordinates(rect);
    try {
      for (const { tx, ty } of candidates) {
        const key = tileKey(tx, ty),
          r = tileRect(tx, ty);
        if (!this.before.has(key))
          this.before.set(key, { tx, ty, asset: this.surface.get(tx, ty) });
        if (!this.writable.has(key)) {
          const old = this.surface.get(tx, ty),
            canvas = rasterCanvas();
          if (old) {
            canvas.getContext('2d')!.drawImage(old.canvas!, 0, 0);
            rasterStats.copiedPixels += TILE_SIZE * TILE_SIZE;
          }
          this.surface.set(
            tx,
            ty,
            createAsset(canvas, { x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE }),
          );
          this.writable.add(key);
        }
        const ctx = this.surface
          .get(tx, ty)!
          .canvas!.getContext('2d', { willReadFrequently: true })!;
        ctx.save();
        try {
          ctx.setTransform(1, 0, 0, 1, -r.x, -r.y);
          ctx.beginPath();
          ctx.rect(rect.x, rect.y, rect.w, rect.h);
          ctx.clip();
          draw(ctx, r);
        } finally {
          ctx.restore();
        }
      }
    } catch (error) {
      this.cancel();
      throw error;
    }
  }
  replaceRegion(rect: PixelRect, pixels: ImageData): void {
    const canvas = rasterCanvas(pixels.width, pixels.height);
    canvas.getContext('2d')!.putImageData(pixels, 0, 0);
    this.mutateRegion(rect, (ctx) => {
      ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
      ctx.drawImage(canvas, rect.x, rect.y);
    });
  }
  beforeSurface(): RasterSurface {
    const surface = this.surface.clone();
    for (const { tx, ty, asset } of this.before.values())
      surface.set(tx, ty, asset);
    return surface;
  }
  resetToBefore(): void {
    for (const { tx, ty, asset } of this.before.values())
      this.surface.set(tx, ty, asset);
    this.writable.clear();
  }
  cancel(): void {
    this.resetToBefore();
    this.before.clear();
  }
  commit(publish = true): RasterChangeSet {
    try {
      const tiles: RasterTilePatch[] = [];
      for (const { tx, ty, asset: old } of this.before.values()) {
        let next = this.surface.get(tx, ty);
        if (next?.id === old?.id) continue;
        const bounds = next ? alphaBounds(next.canvas!) : null;
        if (!bounds) {
          this.surface.set(tx, ty, null);
          next = null;
        } else if (next) {
          next.bounds = bounds;
          knownBounds.set(next, bounds);
        }
        if (old && next) {
          const a = old
            .canvas!.getContext('2d')!
            .getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
          const b = next
            .canvas!.getContext('2d')!
            .getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
          if (a.every((v, i) => v === b[i])) {
            this.surface.set(tx, ty, old);
            continue;
          }
        }
        if (publish) {
          if (old) publishAsset(old);
          if (next) publishAsset(next);
        }
        if (old || next)
          tiles.push({
            tx,
            ty,
            before: old?.id ?? null,
            after: next?.id ?? null,
          });
      }
      this.before.clear();
      this.writable.clear();
      rasterStats.changedTiles += tiles.length;
      return { tiles };
    } catch (error) {
      this.cancel();
      throw error;
    }
  }
}
export function surfaceFromCanvas(
  canvas: HTMLCanvasElement,
  x = 0,
  y = 0,
): RasterSurface {
  const surface = new RasterSurface(),
    edit = new RasterEditSession(surface);
  edit.mutateRegion({ x, y, w: canvas.width, h: canvas.height }, (ctx) =>
    ctx.drawImage(canvas, x, y),
  );
  edit.commit();
  return surface;
}
export function assetsForSurface(surface: RasterSurface): Set<string> {
  return new Set([...surface.entries()].map((t) => getAsset(t.asset.id).id));
}
