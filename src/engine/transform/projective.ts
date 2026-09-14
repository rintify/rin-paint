import type { TransformState } from '../../model/transform';
import type { PixelRect } from '../raster/geometry';
export type Matrix = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
function multiply(a: Matrix, b: Matrix): Matrix {
  return Array.from({ length: 9 }, (_, i) => {
    const r = Math.floor(i / 3) * 3,
      c = i % 3;
    return a[r] * b[c] + a[r + 1] * b[c + 3] + a[r + 2] * b[c + 6];
  }) as Matrix;
}
export function transformMatrix(
  s: TransformState,
  w: number,
  h: number,
): Matrix {
  const angle = (s.rotation * Math.PI) / 180,
    c = Math.cos(angle),
    n = Math.sin(angle);
  const sx = s.scaleX / 100,
    sy = s.scaleY / 100,
    k = Math.tan((s.shear * Math.PI) / 180);
  const affine: Matrix = [
    c * sx,
    (c * k - n) * sy,
    0,
    n * sx,
    (n * k + c) * sy,
    0,
    s.perspectiveX / (100 * w),
    s.perspectiveY / (100 * h),
    1,
  ];
  return multiply(
    [1, 0, w / 2 + s.translateX, 0, 1, h / 2 + s.translateY, 0, 0, 1],
    multiply(affine, [1, 0, -w / 2, 0, 1, -h / 2, 0, 0, 1]),
  );
}
export function inverseMatrix(m: Matrix): Matrix | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const v: Matrix = [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
  const det = a * v[0] + b * v[3] + c * v[6];
  return Math.abs(det) < 1e-12 ? null : (v.map((x) => x / det) as Matrix);
}
export function mapPoint(m: Matrix, x: number, y: number) {
  const z = m[6] * x + m[7] * y + m[8];
  return {
    x: (m[0] * x + m[1] * y + m[2]) / z,
    y: (m[3] * x + m[4] * y + m[5]) / z,
  };
}
export function transformedBounds(m: Matrix, r: PixelRect): PixelRect | null {
  const corners = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ];
  const denominators = corners.map(([x, y]) => m[6] * x + m[7] * y + m[8]);
  if (Math.min(...denominators) <= 0 && Math.max(...denominators) >= 0)
    return null;
  const points = corners.map(([x, y]) => mapPoint(m, x, y));
  const x = Math.floor(Math.min(...points.map((p) => p.x))),
    y = Math.floor(Math.min(...points.map((p) => p.y)));
  return {
    x,
    y,
    w: Math.ceil(Math.max(...points.map((p) => p.x))) - x,
    h: Math.ceil(Math.max(...points.map((p) => p.y))) - y,
  };
}

/** Recover editable parameters after a direct manipulation of the homography. */
export function matrixToTransform(
  matrix: Matrix,
  w: number,
  h: number,
): TransformState | null {
  const centered = multiply(matrix, [1, 0, w / 2, 0, 1, h / 2, 0, 0, 1]);
  if (Math.abs(centered[8]) < 1e-10) return null;
  const m = centered.map((value) => value / centered[8]);
  const a = m[0] - m[2] * m[6],
    b = m[1] - m[2] * m[7];
  const c = m[3] - m[5] * m[6],
    d = m[4] - m[5] * m[7];
  const sx = Math.hypot(a, c);
  if (sx < 1e-8) return null;
  const sy = (a * d - b * c) / sx;
  if (Math.abs(sy) < 1e-8) return null;
  const result: TransformState = {
    translateX: m[2] - w / 2,
    translateY: m[5] - h / 2,
    rotation: (Math.atan2(c, a) * 180) / Math.PI,
    scaleX: sx * 100,
    scaleY: sy * 100,
    shear: (Math.atan((a * b + c * d) / (sx * sy)) * 180) / Math.PI,
    perspectiveX: m[6] * w * 100,
    perspectiveY: m[7] * h * 100,
  };
  // Keep affine drags on the native canvas path rather than a noisy projective readback.
  for (const key of Object.keys(result) as (keyof TransformState)[]) {
    if (Math.abs(result[key]) < 1e-9) result[key] = 0;
    if (Math.abs(result[key] - 100) < 1e-9) result[key] = 100;
  }
  return result;
}

export interface Point {
  x: number;
  y: number;
}
export function rectCorners(rect: PixelRect): Point[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
}

/** Solve a true projective map, rejecting folded or collapsed target frames. */
export function quadMatrix(source: Point[], target: Point[]): Matrix | null {
  let direction = 0;
  for (let i = 0; i < 4; i++) {
    const a = target[i],
      b = target[(i + 1) % 4],
      c = target[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6 || (direction && Math.sign(cross) !== direction))
      return null;
    direction = Math.sign(cross);
  }
  const rows = source.flatMap(({ x, y }, i) => {
    const { x: u, y: v } = target[i];
    return [
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v],
    ];
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++)
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    if (Math.abs(rows[pivot][col]) < 1e-10) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col];
    for (let j = col; j < 9; j++) rows[col][j] /= divisor;
    for (let row = 0; row < 8; row++)
      if (row !== col) {
        const factor = rows[row][col];
        for (let j = col; j < 9; j++) rows[row][j] -= factor * rows[col][j];
      }
  }
  return [...rows.map((row) => row[8]), 1] as Matrix;
}
