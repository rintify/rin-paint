export type Homography = readonly [number, number, number, number, number, number, number, number, number];

export interface TransformState {
  /** Row-major 3x3 projective matrix in millimetres. */
  matrix: Homography;
  pivotMm: { x: number; y: number };
  interpolation: 'nearest' | 'linear' | 'cubic';
}

export const IDENTITY_HOMOGRAPHY: Homography = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function identityTransformState(): TransformState {
  return { matrix: [...IDENTITY_HOMOGRAPHY], pivotMm: { x: 0, y: 0 }, interpolation: 'linear' };
}

export function multiplyHomography(a: Homography, b: Homography): Homography {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] = a[row * 3] * b[col]
        + a[row * 3 + 1] * b[3 + col]
        + a[row * 3 + 2] * b[6 + col];
    }
  }
  return out as unknown as Homography;
}

export function homographyDeterminant(m: Homography): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7])
    - m[1] * (m[3] * m[8] - m[5] * m[6])
    + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

export function invertHomography(m: Homography): Homography | null {
  const d = homographyDeterminant(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-10) return null;
  return [
    (m[4] * m[8] - m[5] * m[7]) / d,
    (m[2] * m[7] - m[1] * m[8]) / d,
    (m[1] * m[5] - m[2] * m[4]) / d,
    (m[5] * m[6] - m[3] * m[8]) / d,
    (m[0] * m[8] - m[2] * m[6]) / d,
    (m[2] * m[3] - m[0] * m[5]) / d,
    (m[3] * m[7] - m[4] * m[6]) / d,
    (m[1] * m[6] - m[0] * m[7]) / d,
    (m[0] * m[4] - m[1] * m[3]) / d,
  ];
}

export function transformPoint(m: Homography, point: { x: number; y: number }): { x: number; y: number } | null {
  const w = m[6] * point.x + m[7] * point.y + m[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-10) return null;
  return {
    x: (m[0] * point.x + m[1] * point.y + m[2]) / w,
    y: (m[3] * point.x + m[4] * point.y + m[5]) / w,
  };
}

/** Exact projective mapping for four point pairs, solved with pivoted elimination. */
export function homographyFromQuads(
  source: readonly { x: number; y: number }[],
  target: readonly { x: number; y: number }[],
): Homography | null {
  if (source.length < 4 || target.length < 4) return null;
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = source[i], { x: u, y: v } = target[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    if (Math.abs(rows[pivot][col]) < 1e-10) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col];
    for (let value = col; value < 9; value++) rows[col][value] /= divisor;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = rows[row][col];
      for (let value = col; value < 9; value++) rows[row][value] -= factor * rows[col][value];
    }
  }
  const matrix = [...rows.map(row => row[8]), 1] as unknown as Homography;
  return Math.abs(homographyDeterminant(matrix)) < 1e-10 || matrix.some(value => !Number.isFinite(value)) ? null : matrix;
}

export interface TransformComponents {
  translateXmm?: number;
  translateYmm?: number;
  rotationDeg?: number;
  scaleX?: number;
  scaleY?: number;
  shearXDeg?: number;
  shearYDeg?: number;
  perspectiveX?: number;
  perspectiveY?: number;
}

export interface DecomposedHomography extends Required<TransformComponents> {}

export function decomposeHomography(matrix: Homography): DecomposedHomography {
  const scaleX = Math.hypot(matrix[0], matrix[3]) || 1;
  const rotation = Math.atan2(matrix[3], matrix[0]);
  const determinant = matrix[0] * matrix[4] - matrix[1] * matrix[3];
  const scaleY = determinant / scaleX || 1;
  const shearX = (matrix[0] * matrix[1] + matrix[3] * matrix[4]) / (scaleX * scaleY);
  return {
    translateXmm: matrix[2], translateYmm: matrix[5],
    rotationDeg: rotation * 180 / Math.PI,
    scaleX, scaleY,
    shearXDeg: Math.atan(shearX) * 180 / Math.PI,
    shearYDeg: 0,
    perspectiveX: matrix[6], perspectiveY: matrix[7],
  };
}

export function composeHomography(value: TransformComponents): Homography {
  const rotation = (value.rotationDeg ?? 0) * Math.PI / 180;
  const sx = value.scaleX ?? 1;
  const sy = value.scaleY ?? 1;
  const shx = Math.tan((value.shearXDeg ?? 0) * Math.PI / 180);
  const shy = Math.tan((value.shearYDeg ?? 0) * Math.PI / 180);
  const c = Math.cos(rotation), s = Math.sin(rotation);
  const affine: Homography = [
    c * sx - s * shy * sx, c * shx * sy - s * sy, value.translateXmm ?? 0,
    s * sx + c * shy * sx, s * shx * sy + c * sy, value.translateYmm ?? 0,
    value.perspectiveX ?? 0, value.perspectiveY ?? 0, 1,
  ];
  return affine;
}

export function transformedBounds(
  inverse: Homography,
  rect: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } | null {
  const points = [
    transformPoint(inverse, { x: rect.x, y: rect.y }),
    transformPoint(inverse, { x: rect.x + rect.w, y: rect.y }),
    transformPoint(inverse, { x: rect.x + rect.w, y: rect.y + rect.h }),
    transformPoint(inverse, { x: rect.x, y: rect.y + rect.h }),
  ];
  if (points.some(point => !point)) return null;
  const valid = points as { x: number; y: number }[];
  const xs = valid.map(point => point.x), ys = valid.map(point => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
