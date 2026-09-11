export interface PolygonSplitToolSettings {
  width: number;
}

export const DEFAULT_POLYGON_SPLIT_TOOL_SETTINGS: PolygonSplitToolSettings = {
  width: 0,
};

export function normalizePolygonSplitToolSettings(value: unknown): PolygonSplitToolSettings {
  const raw = value && typeof value === 'object' ? (value as Partial<PolygonSplitToolSettings>) : {};
  return {
    width:
      typeof raw.width === 'number' && Number.isFinite(raw.width)
        ? Math.max(0, Math.min(128, raw.width))
        : DEFAULT_POLYGON_SPLIT_TOOL_SETTINGS.width,
  };
}
