import { intersect, tileCoordinates, tileKey, tileRect, TILE_SIZE, union, type PixelRect } from './geometry';

interface AlphaTile {
  pixels: Uint8Array;
  bounds: PixelRect;
}

/** Transient alpha only: contour extraction does not create persistent raster assets. */
export class SparseAlphaTiles {
  private readonly tiles = new Map<string, AlphaTile>();

  setRgba(tx: number, ty: number, rgba: Uint8ClampedArray): void {
    const pixels = new Uint8Array(TILE_SIZE * TILE_SIZE);
    let minX = TILE_SIZE, minY = TILE_SIZE, maxX = -1, maxY = -1;
    for (let y = 0, i = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++, i++) {
        const alpha = rgba[i * 4 + 3];
        pixels[i] = alpha;
        if (!alpha) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    const key = tileKey(tx, ty);
    if (maxX < 0) {
      this.tiles.delete(key);
      return;
    }
    this.tiles.set(key, {
      pixels,
      bounds: { x: tx * TILE_SIZE + minX, y: ty * TILE_SIZE + minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    });
  }

  sample(gridX: number, gridY: number): number {
    const x = gridX - 1, y = gridY - 1;
    const tx = Math.floor(x / TILE_SIZE), ty = Math.floor(y / TILE_SIZE);
    return this.tiles.get(tileKey(tx, ty))?.pixels[(y - ty * TILE_SIZE) * TILE_SIZE + x - tx * TILE_SIZE] ?? 0;
  }

  /** Scan contiguous rows and allocate marching-square cells only at the boundary. */
  *boundaryCells(limit: number): Generator<{ x: number; y: number }> {
    const candidates = new Map<string, PixelRect>();
    for (const { bounds } of this.tiles.values()) {
      const rect = { ...bounds, w: bounds.w + 1, h: bounds.h + 1 };
      for (const tile of tileCoordinates(rect)) {
        const key = tileKey(tile.tx, tile.ty);
        candidates.set(key, union(candidates.get(key) ?? null, intersect(rect, tileRect(tile.tx, tile.ty))!));
      }
    }
    const iso = Math.max(0.5, limit);
    for (const rect of candidates.values()) {
      // A one-pixel halo joins contours across tiles, including negative coordinates.
      const region = { x: rect.x - 1, y: rect.y - 1, w: rect.w + 1, h: rect.h + 1 };
      const pixels = new Uint8Array(region.w * region.h);
      for (const { tx, ty } of tileCoordinates(region)) {
        const tile = this.tiles.get(tileKey(tx, ty));
        if (!tile) continue;
        const part = intersect(region, tileRect(tx, ty))!;
        for (let y = part.y; y < part.y + part.h; y++) {
          const start = (y - ty * TILE_SIZE) * TILE_SIZE + part.x - tx * TILE_SIZE;
          pixels.set(tile.pixels.subarray(start, start + part.w), (y - region.y) * region.w + part.x - region.x);
        }
      }
      for (let y = 0; y < rect.h; y++) {
        let i = y * region.w;
        for (let x = 0; x < rect.w; x++, i++) {
          const a = pixels[i] >= iso, b = pixels[i + 1] >= iso;
          const c = pixels[i + region.w] >= iso, d = pixels[i + region.w + 1] >= iso;
          if (a === b && a === c && a === d) continue;
          yield { x: rect.x + x, y: rect.y + y };
        }
      }
    }
  }
}
