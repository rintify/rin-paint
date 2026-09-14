import { intersect, type PixelRect } from './geometry';
import type { RasterPoint } from './RasterResampler';

interface Vertex extends RasterPoint {
  u: number;
  v: number;
}
export interface RasterSpan {
  y: number;
  x0: number;
  x1: number;
  ux: number;
  uy: number;
  u0: number;
  vx: number;
  vy: number;
  v0: number;
}
interface Triangle {
  vertices: [Vertex, Vertex, Vertex];
  bounds: PixelRect;
  area: number;
}
const edge = (a: RasterPoint, b: RasterPoint, p: RasterPoint) =>
  (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
const topLeft = (a: RasterPoint, b: RasterPoint) =>
  b.y < a.y || (b.y === a.y && b.x > a.x);

/** One shared tessellation for the entire selection, independent of destination tiles. */
export class RasterWarpMesh {
  readonly divisions: number;
  private affine: readonly RasterPoint[] | null;
  private triangles: Triangle[] = [];
  private vertices: Vertex[][] = [];

  constructor(corners: readonly RasterPoint[], pixelScale = 1) {
    this.affine =
      Math.abs(corners[0].x + corners[2].x - corners[1].x - corners[3].x) <
        1e-8 &&
      Math.abs(corners[0].y + corners[2].y - corners[1].y - corners[3].y) < 1e-8
        ? corners
        : null;
    const maxEdge = Math.max(
      ...corners.map((p, i) =>
        Math.hypot(p.x - corners[(i + 1) % 4].x, p.y - corners[(i + 1) % 4].y),
      ),
    );
    this.divisions = this.affine
      ? 1
      : Math.max(4, Math.min(32, Math.ceil(maxEdge / (48 * pixelScale))));
    for (let y = 0; y <= this.divisions; y++) {
      const row: Vertex[] = [];
      for (let x = 0; x <= this.divisions; x++) {
        const u = x / this.divisions,
          v = y / this.divisions;
        row.push({
          u,
          v,
          x:
            corners[0].x * (1 - u) * (1 - v) +
            corners[1].x * u * (1 - v) +
            corners[2].x * u * v +
            corners[3].x * (1 - u) * v,
          y:
            corners[0].y * (1 - u) * (1 - v) +
            corners[1].y * u * (1 - v) +
            corners[2].y * u * v +
            corners[3].y * (1 - u) * v,
        });
      }
      this.vertices.push(row);
    }
    for (let y = 0; y < this.divisions; y++)
      for (let x = 0; x < this.divisions; x++) {
        const a = this.vertices[y][x],
          b = this.vertices[y][x + 1],
          c = this.vertices[y + 1][x + 1],
          d = this.vertices[y + 1][x];
        this.add(a, b, c);
        this.add(a, c, d);
      }
  }

  private add(a: Vertex, b: Vertex, c: Vertex): void {
    let area = edge(a, b, c);
    if (Math.abs(area) < 1e-12) return;
    if (area < 0) {
      [b, c] = [c, b];
      area = -area;
    }
    const x = Math.min(a.x, b.x, c.x),
      y = Math.min(a.y, b.y, c.y);
    this.triangles.push({
      vertices: [a, b, c],
      area,
      bounds: {
        x,
        y,
        w: Math.max(a.x, b.x, c.x) - x,
        h: Math.max(a.y, b.y, c.y) - y,
      },
    });
  }

  /** Apply the same piecewise affine map when enumerating occupied source regions. */
  map(u: number, v: number): RasterPoint {
    const gx = Math.min(this.divisions - 1, Math.floor(u * this.divisions)),
      gy = Math.min(this.divisions - 1, Math.floor(v * this.divisions));
    const fx = u * this.divisions - gx,
      fy = v * this.divisions - gy;
    const a = this.vertices[gy][gx],
      c = this.vertices[gy + 1][gx + 1];
    const b = fx >= fy ? this.vertices[gy][gx + 1] : this.vertices[gy + 1][gx];
    const wb = Math.abs(fx - fy),
      wc = Math.min(fx, fy),
      wa = 1 - wb - wc;
    return {
      x: a.x * wa + b.x * wb + c.x * wc,
      y: a.y * wa + b.y * wb + c.y * wc,
    };
  }

  regionPoints(u0: number, v0: number, u1: number, v1: number): RasterPoint[] {
    if (this.affine)
      return [
        this.map(u0, v0),
        this.map(u1, v0),
        this.map(u1, v1),
        this.map(u0, v1),
      ];
    const us = [u0, u1],
      vs = [v0, v1];
    for (let i = 1; i < this.divisions; i++) {
      const n = i / this.divisions;
      if (n > u0 && n < u1) us.push(n);
      if (n > v0 && n < v1) vs.push(n);
    }
    // Diagonal intersections matter when a narrow occupied rectangle crosses a mesh diagonal.
    const result = us.flatMap((u) => vs.map((v) => this.map(u, v)));
    for (const u of us)
      for (
        let k = Math.ceil((v0 - u) * this.divisions);
        k <= Math.floor((v1 - u) * this.divisions);
        k++
      ) {
        const v = u + k / this.divisions;
        if (v >= v0 && v <= v1) result.push(this.map(u, v));
      }
    for (const v of vs)
      for (
        let k = Math.ceil((v - u1) * this.divisions);
        k <= Math.floor((v - u0) * this.divisions);
        k++
      ) {
        const u = v + k / this.divisions;
        if (u >= u0 && u <= u1) result.push(this.map(u, v));
      }
    return result;
  }

  /** Half-open triangle scan conversion. Shared edges have one owner; later triangles win folds. */
  forEachSpan(rect: PixelRect, visit: (span: RasterSpan) => void): void {
    for (const triangle of this.triangles) {
      const area = intersect(triangle.bounds, rect);
      if (!area) continue;
      const [a, b, c] = triangle.vertices,
        det = triangle.area;
      const ux = ((b.u - a.u) * (c.y - a.y) - (c.u - a.u) * (b.y - a.y)) / det;
      const uy = ((c.u - a.u) * (b.x - a.x) - (b.u - a.u) * (c.x - a.x)) / det;
      const vx = ((b.v - a.v) * (c.y - a.y) - (c.v - a.v) * (b.y - a.y)) / det;
      const vy = ((c.v - a.v) * (b.x - a.x) - (b.v - a.v) * (c.x - a.x)) / det;
      const coefficients = {
        ux,
        uy,
        u0: a.u - ux * a.x - uy * a.y,
        vx,
        vy,
        v0: a.v - vx * a.x - vy * a.y,
      };
      const edges = [
        [a, b],
        [b, c],
        [c, a],
      ].map(([p, q]) => ({ p, q, dx: p.y - q.y, inclusive: topLeft(p, q) }));
      const minX = Math.ceil(area.x - 0.5),
        maxX = Math.ceil(area.x + area.w - 0.5) - 1;
      for (
        let y = Math.ceil(area.y - 0.5);
        y < Math.ceil(area.y + area.h - 0.5);
        y++
      ) {
        let x0 = minX,
          x1 = maxX;
        for (const { p, q, dx, inclusive } of edges) {
          const k = (q.x - p.x) * (y + 0.5 - p.y) - (q.y - p.y) * (0.5 - p.x);
          if (dx > 0)
            x0 = Math.max(
              x0,
              inclusive ? Math.ceil(-k / dx) : Math.floor(-k / dx) + 1,
            );
          else if (dx < 0)
            x1 = Math.min(
              x1,
              inclusive ? Math.floor(-k / dx) : Math.ceil(-k / dx) - 1,
            );
          else if (k < 0 || (k === 0 && !inclusive)) {
            x1 = x0 - 1;
            break;
          }
        }
        if (x0 <= x1) visit({ y, x0, x1: x1 + 1, ...coefficients });
      }
    }
  }

  sampler(rect: PixelRect): (x: number, y: number) => RasterPoint | null {
    if (this.affine) {
      const [a, b, , d] = this.affine;
      const ex = b.x - a.x,
        ey = b.y - a.y,
        fx = d.x - a.x,
        fy = d.y - a.y;
      const det = ex * fy - ey * fx;
      if (Math.abs(det) < 1e-12) return () => null;
      return (x, y) => {
        const px = x - a.x,
          py = y - a.y;
        const u = (px * fy - py * fx) / det,
          v = (py * ex - px * ey) / det;
        return u >= 0 && u < 1 && v >= 0 && v < 1 ? { x: u, y: v } : null;
      };
    }
    const triangles = this.triangles.filter((t) => intersect(t.bounds, rect));
    // A pixel only tests triangles in its small spatial bucket, retaining draw order.
    const buckets = new Map<string, Triangle[]>();
    const cellSize = 16;
    for (const triangle of triangles) {
      const r = intersect(triangle.bounds, rect)!;
      for (
        let y = Math.floor(r.y / cellSize);
        y <= Math.floor((r.y + r.h) / cellSize);
        y++
      )
        for (
          let x = Math.floor(r.x / cellSize);
          x <= Math.floor((r.x + r.w) / cellSize);
          x++
        ) {
          const key = `${x},${y}`;
          const list = buckets.get(key) ?? [];
          if (!buckets.has(key)) buckets.set(key, list);
          list.push(triangle);
        }
    }
    let lastX = NaN,
      lastY = NaN,
      nearby: Triangle[] = [];

    return (x, y) => {
      const bx = Math.floor(x / cellSize),
        by = Math.floor(y / cellSize);
      if (bx !== lastX || by !== lastY) {
        lastX = bx;
        lastY = by;
        nearby = buckets.get(`${bx},${by}`) ?? [];
      }
      const p = { x, y };
      // A consistent half-open edge rule gives each shared edge exactly one owner.
      for (let i = nearby.length - 1; i >= 0; i--) {
        const {
          vertices: [a, b, c],
          area,
        } = nearby[i];
        const ea = edge(b, c, p),
          eb = edge(c, a, p),
          ec = edge(a, b, p);
        if (
          ea < 0 ||
          eb < 0 ||
          ec < 0 ||
          (ea === 0 && !topLeft(b, c)) ||
          (eb === 0 && !topLeft(c, a)) ||
          (ec === 0 && !topLeft(a, b))
        )
          continue;
        return {
          x: (ea * a.u + eb * b.u + ec * c.u) / area,
          y: (ea * a.v + eb * b.v + ec * c.v) / area,
        };
      }
      return null;
    };
  }
}
