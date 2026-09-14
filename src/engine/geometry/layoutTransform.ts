import {IDENTITY, inverse, multiply, scaling, transformBounds, type Homography, type RectMm} from './homography';

export interface LayoutTransform { matrix?: Homography }
export function layoutMatrixPixels(state: LayoutTransform, ppi: number): Homography {
  const px = ppi / 25.4;
  return state.matrix ? multiply(scaling(px), multiply(state.matrix, scaling(1 / px))) : IDENTITY;
}
export function layoutBounds(state: LayoutTransform, bounds: RectMm, ppi: number): RectMm | null {
  return transformBounds(layoutMatrixPixels(state, ppi), bounds);
}
export function readLayoutTransform(value: unknown): LayoutTransform {
  const matrix = (value as LayoutTransform | null)?.matrix;
  if (matrix === undefined) return {matrix: [...IDENTITY]};
  if (!Array.isArray(matrix) || matrix.length !== 9 || !matrix.every(Number.isFinite) || !inverse(matrix)) throw new Error('レイヤーの変形行列が不正です');
  return {matrix: [...matrix] as unknown as Homography};
}
export function isSimilarity(matrix: Homography): boolean {
  const scale = Math.max(1, Math.abs(matrix[0]), Math.abs(matrix[1]), Math.abs(matrix[3]), Math.abs(matrix[4]));
  return Math.abs(matrix[6]) < 1e-12 && Math.abs(matrix[7]) < 1e-12
    && Math.abs(matrix[0] - matrix[4]) < 1e-10 * scale && Math.abs(matrix[1] + matrix[3]) < 1e-10 * scale;
}
