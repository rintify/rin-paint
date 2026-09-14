import type { RasterEditSession } from './raster/RasterSurface';
import { tileCoordinates, tileKey, tileRect } from './raster/geometry';
export interface DirtyRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyRect(): DirtyRect {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function expandRect(
  r: DirtyRect,
  x: number,
  y: number,
  pad: number,
): void {
  r.minX = Math.min(r.minX, x - pad);
  r.minY = Math.min(r.minY, y - pad);
  r.maxX = Math.max(r.maxX, x + pad);
  r.maxY = Math.max(r.maxY, y + pad);
}

export function unionRect(a: DirtyRect, b: DirtyRect): DirtyRect {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function rectValid(r: DirtyRect): boolean {
  return r.maxX > r.minX && r.maxY > r.minY;
}

let checkerTile: HTMLCanvasElement | null = null;

/** 透明色の表示に使う市松模様パターン */
export function checkerPattern(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (!checkerTile) {
    checkerTile = document.createElement('canvas');
    checkerTile.width = 12;
    checkerTile.height = 12;
    const c = checkerTile.getContext('2d')!;
    c.fillStyle = '#c9c9c9';
    c.fillRect(0, 0, 12, 12);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, 6, 6);
    c.fillRect(6, 6, 6, 6);
  }
  return ctx.createPattern(checkerTile, 'repeat')!;
}

/**
 * 円スタンプを線分に沿って敷き詰めて不透明ストロークを描く。
 * 1つの Path2D にまとめて1回 fill するので重ね塗りムラが出ない。
 */
export function stampSegment(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
  color: string,
  erase: boolean,
): void {
  const dist = Math.hypot(bx - ax, by - ay);
  const minR = Math.max(0.35, Math.min(ar, br));
  const steps = Math.max(1, Math.ceil(dist / Math.max(0.75, minR * 0.35)));
  const path = new Path2D();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const r = Math.max(0.35, ar + (br - ar) * t);
    path.moveTo(x + r, y);
    path.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.save();
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  // destination-out はソースのアルファだけを見るので、消すときは不透明色を使う
  ctx.fillStyle = erase ? '#000000' : color;
  ctx.fill(path);
  ctx.restore();
}

export function stampRasterSegment(
  edit: RasterEditSession,
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
  color: string,
  erase: boolean,
): void {
  const dist = Math.hypot(bx - ax, by - ay),
    steps = Math.max(
      1,
      Math.ceil(dist / Math.max(0.75, Math.max(0.35, Math.min(ar, br)) * 0.35)),
    );
  const tiles = new Map<string, { tx: number; ty: number; path: Path2D }>();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps,
      x = ax + (bx - ax) * t,
      y = ay + (by - ay) * t,
      r = Math.max(0.35, ar + (br - ar) * t);
    for (const tile of tileCoordinates({
      x: x - r - 2,
      y: y - r - 2,
      w: 2 * r + 4,
      h: 2 * r + 4,
    })) {
      const key = tileKey(tile.tx, tile.ty);
      let entry = tiles.get(key);
      if (!entry) {
        entry = { ...tile, path: new Path2D() };
        tiles.set(key, entry);
      }
      const origin = tileRect(tile.tx, tile.ty),
        lx = x - origin.x,
        ly = y - origin.y;
      entry.path.moveTo(lx + r, ly);
      entry.path.arc(lx, ly, r, 0, Math.PI * 2);
    }
  }
  for (const { tx, ty, path } of tiles.values()) {
    const rect = tileRect(tx, ty);
    edit.mutateRegion(
      rect,
      (ctx) => {
        ctx.translate(rect.x, rect.y);
        ctx.globalCompositeOperation = erase
          ? 'destination-out'
          : 'source-over';
        ctx.fillStyle = erase ? '#000000' : color;
        ctx.fill(path);
      },
      erase,
    );
  }
}
