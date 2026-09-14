/** Translation is stored in canvas pixels; the inspector converts it to physical millimetres. */
export interface TransformState {
  translateX: number;
  translateY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  shear: number;
  perspectiveX: number;
  perspectiveY: number;
}
export const DEFAULT_TRANSFORM: TransformState = {
  translateX: 0,
  translateY: 0,
  rotation: 0,
  scaleX: 100,
  scaleY: 100,
  shear: 0,
  perspectiveX: 0,
  perspectiveY: 0,
};
export function normalizeTransform(value: unknown): TransformState {
  const input = (
    value && typeof value === 'object' ? value : {}
  ) as Partial<TransformState>;
  const result = { ...DEFAULT_TRANSFORM };
  for (const key of Object.keys(
    DEFAULT_TRANSFORM,
  ) as (keyof TransformState)[]) {
    const n = input[key];
    if (typeof n === 'number' && Number.isFinite(n)) result[key] = n;
  }
  return result;
}
