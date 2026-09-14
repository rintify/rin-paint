import { intersect, type PixelRect } from './geometry';
import type { RasterPoint } from './RasterResampler';

interface Vertex extends RasterPoint {
  u: number;
  v: number;
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
  private triangles: Triangle[] = [];
  private vertices: Vertex[][] = [];

  constructor(corners: readonly RasterPoint[]) {
    const maxEdge = Math.max(
      ...corners.map((p, i) =>
        Math.hypot(p.x - corners[(i + 1) % 4].x, p.y - corners[(i + 1) % 4].y),
      ),
    );
    this.divisions = Math.max(4, Math.min(32, Math.ceil(maxEdge / 48)));
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
      for (let k = -this.divisions; k <= this.divisions; k++) {
        const v = u + k / this.divisions;
        if (v >= v0 && v <= v1) result.push(this.map(u, v));
      }
    for (const v of vs)
      for (let k = -this.divisions; k <= this.divisions; k++) {
        const u = v + k / this.divisions;
        if (u >= u0 && u <= u1) result.push(this.map(u, v));
      }
    return result;
  }

  sampler(rect: PixelRect): (x: number, y: number) => RasterPoint | null {
    const triangles = this.triangles.filter((t) => intersect(t.bounds, rect));
    return (x, y) => {
      const p = { x, y };
      // A consistent half-open edge rule gives each shared edge exactly one owner.
      for (let i = triangles.length - 1; i >= 0; i--) {
        const {
          vertices: [a, b, c],
          area,
        } = triangles[i];
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
