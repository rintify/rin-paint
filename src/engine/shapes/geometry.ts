import type { ShapePoint } from '../../model';

/** 図形の外接矩形 */
export interface ShapeBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function cloneShape<T>(shape: T): T {
  return structuredClone(shape);
}

export function pointsBounds(points: ShapePoint[]): ShapeBounds {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export function rotateAround(x: number, y: number, pivot: ShapePoint, angle: number): ShapePoint {
  const dx = x - pivot.x, dy = y - pivot.y, cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
}

/** 中心・半サイズ・回転角から四隅を左上まわりの順で返す */
export function centeredCorners(center: ShapePoint, hw: number, hh: number, angle: number): ShapePoint[] {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos }));
}

function orientation(a: ShapePoint, b: ShapePoint, c: ShapePoint): number { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function onSegment(a: ShapePoint, b: ShapePoint, p: ShapePoint): boolean {
  const e = 1e-7;
  return Math.abs(orientation(a, b, p)) <= e && p.x >= Math.min(a.x, b.x) - e && p.x <= Math.max(a.x, b.x) + e && p.y >= Math.min(a.y, b.y) - e && p.y <= Math.max(a.y, b.y) + e;
}

export function segmentsIntersect(a: ShapePoint, b: ShapePoint, c: ShapePoint, d: ShapePoint): boolean {
  const abC = orientation(a, b, c), abD = orientation(a, b, d), cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return (Math.abs(abC) <= 1e-7 && onSegment(a, b, c)) || (Math.abs(abD) <= 1e-7 && onSegment(a, b, d)) || (Math.abs(cdA) <= 1e-7 && onSegment(c, d, a)) || (Math.abs(cdB) <= 1e-7 && onSegment(c, d, b));
}

export function polygonSelfIntersects(points: ShapePoint[]): boolean {
  const count = points.length;
  if (count < 3) return true;
  for (let i = 0; i < count; i++) {
    const a = points[i], b = points[(i + 1) % count];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) return true;
    for (let j = i + 1; j < count; j++) {
      if (j === i || j === (i + 1) % count || (j + 1) % count === i) continue;
      if (segmentsIntersect(a, b, points[j], points[(j + 1) % count])) return true;
    }
  }
  return false;
}

export function pointInPolygon(point: ShapePoint, polygon: ShapePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (onSegment(a, b, point)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonArea(points: ShapePoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; sum += a.x * b.y - b.x * a.y; }
  return sum / 2;
}
