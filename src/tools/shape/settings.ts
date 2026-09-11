import { normalizeShapePaintMode, type ShapePaintMode } from '../../model';

export interface ShapeToolSettings {
  paintMode: ShapePaintMode;
}

export const DEFAULT_SHAPE_TOOL_SETTINGS: ShapeToolSettings = {
  paintMode: 'stroke',
};

export function normalizeShapeToolSettings(value: unknown): ShapeToolSettings {
  const raw = value && typeof value === 'object' ? (value as Partial<ShapeToolSettings>) : {};
  return {
    paintMode: normalizeShapePaintMode(raw.paintMode),
  };
}
