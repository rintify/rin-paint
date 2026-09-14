import type { PointMm, RectMm, Homography } from '../../model/geometry';
export type { PointMm, RectMm, Homography } from '../../model/geometry';
export const IDENTITY: Homography = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const EPSILON = 1e-10;

export function multiply(a: Homography, b: Homography): Homography {
  const result = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    for (let k = 0; k < 3; k++) result[row * 3 + col] += a[row * 3 + k] * b[k * 3 + col];
  }
  return result as unknown as Homography;
}

export function inverse(m: Homography): Homography | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const cofactors = [e*i-f*h, c*h-b*i, b*f-c*e, f*g-d*i, a*i-c*g, c*d-a*f, d*h-e*g, b*g-a*h, a*e-b*d];
  const det = a * cofactors[0] + b * cofactors[3] + c * cofactors[6];
  if (!Number.isFinite(det) || Math.abs(det) < EPSILON) return null;
  const result = cofactors.map(v => v / det);
  return result.every(Number.isFinite) ? result as unknown as Homography : null;
}

export function project(m: Homography, p: PointMm): PointMm | null {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  if (!Number.isFinite(w) || Math.abs(w) < EPSILON) return null;
  const x = (m[0] * p.x + m[1] * p.y + m[2]) / w;
  const y = (m[3] * p.x + m[4] * p.y + m[5]) / w;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function translation(x: number, y: number): Homography { return [1, 0, x, 0, 1, y, 0, 0, 1]; }
export function scaling(x: number, y = x): Homography { return [x, 0, 0, 0, y, 0, 0, 0, 1]; }
export function rotation(radians: number): Homography {
  const c = Math.cos(radians), s = Math.sin(radians);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
export function shear(x: number, y = 0): Homography { return [1, x, 0, y, 1, 0, 0, 0, 1]; }
export function around(matrix: Homography, pivot: PointMm): Homography {
  return multiply(translation(pivot.x, pivot.y), multiply(matrix, translation(-pivot.x, -pivot.y)));
}
export function conjugate(operator: Homography, change: Homography): Homography {
  const inv = inverse(change);
  if (!inv) throw new Error('変形が潰れているため確定できません');
  return multiply(change, multiply(operator, inv));
}
export function corners(rect: RectMm): PointMm[] {
  return [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h }];
}
export function bounds(points: readonly PointMm[]): RectMm | null {
  if (!points.length) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of points) { left = Math.min(left, p.x); top = Math.min(top, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  return { x: left, y: top, w: right - left, h: bottom - top };
}
/** null denotes an unbounded request crossing the projective horizon, not an empty image. */
export function transformBounds(matrix: Homography, rect: RectMm): RectMm | null {
  const pts = corners(rect);
  const denominators = pts.map(p => matrix[6] * p.x + matrix[7] * p.y + matrix[8]);
  if (Math.min(...denominators) <= EPSILON && Math.max(...denominators) >= -EPSILON) return null;
  const mapped = pts.map(p => project(matrix, p));
  return mapped.every((p): p is PointMm => p !== null) ? bounds(mapped) : null;
}
export function isConvexQuad(points: readonly PointMm[]): boolean {
  if (points.length !== 4 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = points[i], b = points[(i+1)%4], c = points[(i+2)%4];
    const cross = (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
    if (Math.abs(cross) < EPSILON) return false;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}

/** Normalized four-point DLT solved with pivoting; rejects folds and singular mappings. */
export function fromQuads(source: readonly PointMm[], target: readonly PointMm[]): Homography | null {
  if (!isConvexQuad(source) || !isConvexQuad(target)) return null;
  const normalize = (pts: readonly PointMm[]) => {
    const cx = pts.reduce((v,p) => v+p.x, 0)/4, cy = pts.reduce((v,p) => v+p.y, 0)/4;
    const extent = Math.max(...pts.map(p => Math.hypot(p.x-cx, p.y-cy)));
    const matrix = multiply(scaling(1/extent), translation(-cx, -cy));
    return { matrix, points: pts.map(p => project(matrix, p)!) };
  };
  const src = normalize(source), dst = normalize(target);
  const rows: number[][] = [];
  for (let k = 0; k < 4; k++) {
    const { x, y } = src.points[k], { x: u, y: v } = dst.points[k];
    rows.push([x,y,1,0,0,0,-u*x,-u*y,u], [0,0,0,x,y,1,-v*x,-v*y,v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col+1; row < 8; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    if (Math.abs(rows[pivot][col]) < EPSILON) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col];
    for (let j = col; j <= 8; j++) rows[col][j] /= divisor;
    for (let row = 0; row < 8; row++) if (row !== col) {
      const factor = rows[row][col];
      for (let j = col; j <= 8; j++) rows[row][j] -= factor * rows[col][j];
    }
  }
  const normalized = [...rows.map(row => row[8]), 1] as unknown as Homography;
  const result = multiply(inverse(dst.matrix)!, multiply(normalized, src.matrix));
  return inverse(result) ? result : null;
}
