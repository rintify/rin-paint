import { clampSplitWidthMm, roundMm } from '../../engine/units';

export interface PolygonSplitToolSettings {
  widthMm: number;
}

export const DEFAULT_POLYGON_SPLIT_TOOL_SETTINGS: PolygonSplitToolSettings = {
  widthMm: 0,
};

export function normalizePolygonSplitToolSettings(value: unknown): PolygonSplitToolSettings {
  const raw = value && typeof value === 'object' ? (value as Partial<PolygonSplitToolSettings>) : {};
  return {
    widthMm:
      typeof raw.widthMm === 'number' && Number.isFinite(raw.widthMm)
        ? roundMm(clampSplitWidthMm(raw.widthMm))
        : DEFAULT_POLYGON_SPLIT_TOOL_SETTINGS.widthMm,
  };
}
