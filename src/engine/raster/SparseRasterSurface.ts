import { mmToPx, pxToMm } from '../units';

export const RASTER_TILE_SIZE = 256;

export interface SparseRasterTile {
  tx: number;
  ty: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export interface SerializedSparseRasterTile {
  tx: number;
  ty: number;
  content: Blob;
}

export interface SerializedSparseRaster {
  ppi: number;
  originMm: { x: number; y: number };
  tileSize: typeof RASTER_TILE_SIZE;
  tiles: SerializedSparseRasterTile[];
}

const SPARSE_MAGIC = new TextEncoder().encode('RINSPR1\0');

function tileKey(tx: number, ty: number): string { return `${tx},${ty}`; }

function floorDiv(value: number, divisor: number): number { return Math.floor(value / divisor); }

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNGの生成に失敗しました')), 'image/png'));
}

/**
 * An unbounded raster backed only by tiles containing pixels. Coordinates passed
 * to this class are raster pixels; originMm anchors pixel (0, 0) in document space.
 */
export class SparseRasterSurface {
  readonly tileSize = RASTER_TILE_SIZE;
  readonly tiles = new Map<string, SparseRasterTile>();

  constructor(
    public ppi: number,
    public originMm = { x: 0, y: 0 },
  ) {
    if (!Number.isFinite(ppi) || ppi <= 0) throw new Error('ラスターPPIは0より大きい必要があります');
  }

  get tileCount(): number { return this.tiles.size; }

  getTile(tx: number, ty: number): SparseRasterTile | undefined {
    return this.tiles.get(tileKey(tx, ty));
  }

  ensureTile(tx: number, ty: number): SparseRasterTile {
    const key = tileKey(tx, ty);
    const current = this.tiles.get(key);
    if (current) return current;
    const canvas = document.createElement('canvas');
    canvas.width = this.tileSize;
    canvas.height = this.tileSize;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('ラスタ―タイルを作成できません');
    const tile = { tx, ty, canvas, ctx };
    this.tiles.set(key, tile);
    return tile;
  }

  deleteTile(tx: number, ty: number): void { this.tiles.delete(tileKey(tx, ty)); }

  clone(): SparseRasterSurface {
    const output = new SparseRasterSurface(this.ppi, { ...this.originMm });
    for (const tile of this.tiles.values()) {
      const copy = output.ensureTile(tile.tx, tile.ty);
      copy.ctx.drawImage(tile.canvas, 0, 0);
    }
    return output;
  }

  pixelToDocumentMm(point: { x: number; y: number }): { x: number; y: number } {
    return { x: this.originMm.x + pxToMm(point.x, this.ppi), y: this.originMm.y + pxToMm(point.y, this.ppi) };
  }

  documentMmToPixel(point: { x: number; y: number }): { x: number; y: number } {
    return { x: mmToPx(point.x - this.originMm.x, this.ppi), y: mmToPx(point.y - this.originMm.y, this.ppi) };
  }

  /** Executes a drawing callback once for every tile intersecting a pixel-space rect. */
  drawInRect(
    rect: { x: number; y: number; w: number; h: number },
    draw: (ctx: CanvasRenderingContext2D, tile: SparseRasterTile) => void,
  ): void {
    if (rect.w <= 0 || rect.h <= 0) return;
    const minTx = floorDiv(rect.x, this.tileSize);
    const minTy = floorDiv(rect.y, this.tileSize);
    const maxTx = floorDiv(Math.ceil(rect.x + rect.w) - 1, this.tileSize);
    const maxTy = floorDiv(Math.ceil(rect.y + rect.h) - 1, this.tileSize);
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const tile = this.ensureTile(tx, ty);
        tile.ctx.save();
        tile.ctx.setTransform(1, 0, 0, 1, -tx * this.tileSize, -ty * this.tileSize);
        draw(tile.ctx, tile);
        tile.ctx.restore();
      }
    }
    this.releaseTransparentTiles(minTx, minTy, maxTx, maxTy);
  }

  drawTo(
    ctx: CanvasRenderingContext2D,
    regionPx: { x: number; y: number; w: number; h: number },
    destination = { x: 0, y: 0 },
  ): void {
    if (regionPx.w <= 0 || regionPx.h <= 0) return;
    const minTx = floorDiv(regionPx.x, this.tileSize);
    const minTy = floorDiv(regionPx.y, this.tileSize);
    const maxTx = floorDiv(Math.ceil(regionPx.x + regionPx.w) - 1, this.tileSize);
    const maxTy = floorDiv(Math.ceil(regionPx.y + regionPx.h) - 1, this.tileSize);
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const tile = this.getTile(tx, ty);
        if (!tile) continue;
        const tileX = tx * this.tileSize, tileY = ty * this.tileSize;
        const sx = Math.max(regionPx.x, tileX), sy = Math.max(regionPx.y, tileY);
        const right = Math.min(regionPx.x + regionPx.w, tileX + this.tileSize);
        const bottom = Math.min(regionPx.y + regionPx.h, tileY + this.tileSize);
        if (right <= sx || bottom <= sy) continue;
        ctx.drawImage(
          tile.canvas,
          sx - tileX, sy - tileY, right - sx, bottom - sy,
          destination.x + sx - regionPx.x, destination.y + sy - regionPx.y, right - sx, bottom - sy,
        );
      }
    }
  }

  /** Draw a document-pixel region while honoring this raster's own PPI/mm origin. */
  drawDocumentTo(
    ctx: CanvasRenderingContext2D,
    documentRegionPx: { x: number; y: number; w: number; h: number },
    documentPpi: number,
  ): void {
    const scale = documentPpi / this.ppi;
    const originX = mmToPx(this.originMm.x, documentPpi);
    const originY = mmToPx(this.originMm.y, documentPpi);
    const right = documentRegionPx.x + documentRegionPx.w;
    const bottom = documentRegionPx.y + documentRegionPx.h;
    for (const tile of this.tiles.values()) {
      const tileX = originX + tile.tx * this.tileSize * scale;
      const tileY = originY + tile.ty * this.tileSize * scale;
      const tileW = this.tileSize * scale, tileH = this.tileSize * scale;
      const left = Math.max(documentRegionPx.x, tileX);
      const top = Math.max(documentRegionPx.y, tileY);
      const clippedRight = Math.min(right, tileX + tileW);
      const clippedBottom = Math.min(bottom, tileY + tileH);
      if (clippedRight <= left || clippedBottom <= top) continue;
      ctx.drawImage(
        tile.canvas,
        (left - tileX) / scale, (top - tileY) / scale,
        (clippedRight - left) / scale, (clippedBottom - top) / scale,
        left - documentRegionPx.x, top - documentRegionPx.y,
        clippedRight - left, clippedBottom - top,
      );
    }
  }

  /** Execute a document-pixel-space edit only on sparse tiles intersecting it. */
  drawDocumentInRect(
    documentRectPx: { x: number; y: number; w: number; h: number },
    documentPpi: number,
    draw: (ctx: CanvasRenderingContext2D) => void,
  ): void {
    const scale = this.ppi / documentPpi;
    const originDocumentX = mmToPx(this.originMm.x, documentPpi);
    const originDocumentY = mmToPx(this.originMm.y, documentPpi);
    const rasterRect = {
      x: (documentRectPx.x - originDocumentX) * scale,
      y: (documentRectPx.y - originDocumentY) * scale,
      w: documentRectPx.w * scale,
      h: documentRectPx.h * scale,
    };
    this.drawInRect(rasterRect, (ctx, tile) => {
      ctx.setTransform(
        scale, 0, 0, scale,
        -originDocumentX * scale - tile.tx * this.tileSize,
        -originDocumentY * scale - tile.ty * this.tileSize,
      );
      draw(ctx);
    });
  }

  contentBoundsPx(): { x: number; y: number; w: number; h: number } | null {
    if (!this.tiles.size) return null;
    const coordinates = [...this.tiles.values()];
    const minTx = Math.min(...coordinates.map(tile => tile.tx));
    const minTy = Math.min(...coordinates.map(tile => tile.ty));
    const maxTx = Math.max(...coordinates.map(tile => tile.tx));
    const maxTy = Math.max(...coordinates.map(tile => tile.ty));
    return {
      x: minTx * this.tileSize,
      y: minTy * this.tileSize,
      w: (maxTx - minTx + 1) * this.tileSize,
      h: (maxTy - minTy + 1) * this.tileSize,
    };
  }

  contentBoundsDocumentPx(documentPpi: number): { x: number; y: number; w: number; h: number } | null {
    const bounds = this.contentBoundsPx();
    if (!bounds) return null;
    const scale = documentPpi / this.ppi;
    return {
      x: mmToPx(this.originMm.x, documentPpi) + bounds.x * scale,
      y: mmToPx(this.originMm.y, documentPpi) + bounds.y * scale,
      w: bounds.w * scale,
      h: bounds.h * scale,
    };
  }

  resample(newPpi: number): SparseRasterSurface {
    if (!Number.isFinite(newPpi) || newPpi <= 0) throw new Error('ラスターPPIは0より大きい必要があります');
    const output = new SparseRasterSurface(newPpi, { ...this.originMm });
    const factor = newPpi / this.ppi;
    for (const tile of this.tiles.values()) {
      const x = tile.tx * this.tileSize * factor;
      const y = tile.ty * this.tileSize * factor;
      const size = this.tileSize * factor;
      output.drawInRect({ x, y, w: size, h: size }, ctx => {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(tile.canvas, x, y, size, size);
      });
    }
    return output;
  }

  releaseTransparentTiles(minTx = -Infinity, minTy = -Infinity, maxTx = Infinity, maxTy = Infinity): void {
    for (const tile of this.tiles.values()) {
      if (tile.tx < minTx || tile.tx > maxTx || tile.ty < minTy || tile.ty > maxTy) continue;
      const pixels = tile.ctx.getImageData(0, 0, this.tileSize, this.tileSize).data;
      let opaque = false;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] !== 0) { opaque = true; break; }
      }
      if (!opaque) this.deleteTile(tile.tx, tile.ty);
    }
  }

  async serialize(): Promise<SerializedSparseRaster> {
    const tiles = await Promise.all([...this.tiles.values()].map(async tile => ({
      tx: tile.tx,
      ty: tile.ty,
      content: await canvasToBlob(tile.canvas),
    })));
    return { ppi: this.ppi, originMm: { ...this.originMm }, tileSize: RASTER_TILE_SIZE, tiles };
  }

  async toBlob(): Promise<Blob> {
    const value = await this.serialize();
    const manifest = new TextEncoder().encode(JSON.stringify({
      ppi: value.ppi,
      originMm: value.originMm,
      tileSize: value.tileSize,
      tiles: value.tiles.map(tile => ({ tx: tile.tx, ty: tile.ty, size: tile.content.size, type: tile.content.type })),
    }));
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, manifest.length, true);
    return new Blob([SPARSE_MAGIC, length, manifest, ...value.tiles.map(tile => tile.content)], {
      type: 'application/x-rinpaint-sparse-raster',
    });
  }

  static async deserialize(value: SerializedSparseRaster): Promise<SparseRasterSurface> {
    if (value.tileSize !== RASTER_TILE_SIZE) throw new Error('未対応のラスタ―タイル形式です');
    const surface = new SparseRasterSurface(value.ppi, { ...value.originMm });
    for (const source of value.tiles) {
      const bitmap = await createImageBitmap(source.content);
      const tile = surface.ensureTile(source.tx, source.ty);
      tile.ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
    }
    surface.releaseTransparentTiles();
    return surface;
  }

  static async fromBlob(blob: Blob): Promise<SparseRasterSurface> {
    const header = new Uint8Array(await blob.slice(0, SPARSE_MAGIC.length + 4).arrayBuffer());
    if (header.length < SPARSE_MAGIC.length + 4 || !SPARSE_MAGIC.every((byte, index) => header[index] === byte)) {
      throw new Error('未対応のラスタ―データ形式です');
    }
    const manifestLength = new DataView(header.buffer, header.byteOffset + SPARSE_MAGIC.length, 4).getUint32(0, true);
    const start = SPARSE_MAGIC.length + 4;
    const manifest = JSON.parse(new TextDecoder().decode(await blob.slice(start, start + manifestLength).arrayBuffer())) as {
      ppi: number;
      originMm: { x: number; y: number };
      tileSize: number;
      tiles: { tx: number; ty: number; size: number; type: string }[];
    };
    let offset = start + manifestLength;
    const tiles = manifest.tiles.map(tile => {
      const content = blob.slice(offset, offset + tile.size, tile.type);
      offset += tile.size;
      return { tx: tile.tx, ty: tile.ty, content };
    });
    return this.deserialize({
      ppi: manifest.ppi,
      originMm: manifest.originMm,
      tileSize: manifest.tileSize as typeof RASTER_TILE_SIZE,
      tiles,
    });
  }
}
