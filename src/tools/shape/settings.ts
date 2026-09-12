import { normalizeShapePaintMode, normalizeShapeStrokeJoin, type ShapePaintMode, type ShapeStrokeJoin } from '../../model';
import { roundMm, SIZE_MM_MAX } from '../../engine/units';

export interface ShapeToolSettings {
  paintMode: ShapePaintMode;
  constrainAspect: boolean;
  strokeJoin: ShapeStrokeJoin;
  cornerRadiusMm: number;
}

export const DEFAULT_SHAPE_TOOL_SETTINGS: ShapeToolSettings = {
  paintMode: 'stroke',
  constrainAspect: false,
  strokeJoin: 'round',
  cornerRadiusMm: 0,
};

export function normalizeShapeToolSettings(value: unknown): ShapeToolSettings {
  const raw = value && typeof value === 'object' ? (value as Partial<ShapeToolSettings>) : {};
  const radius = Number(raw.cornerRadiusMm);
  return {
    paintMode: normalizeShapePaintMode(raw.paintMode),
    constrainAspect: raw.constrainAspect === true,
    strokeJoin: normalizeShapeStrokeJoin(raw.strokeJoin),
    cornerRadiusMm: Number.isFinite(radius) ? roundMm(Math.max(0, Math.min(SIZE_MM_MAX, radius))) : 0,
  };
}
