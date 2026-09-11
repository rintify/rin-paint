export interface FillToolSettings {
  gapClosePx: number;
  colorTolerance: number;
}

export const DEFAULT_FILL_TOOL_SETTINGS: FillToolSettings = {
  gapClosePx: 0,
  colorTolerance: 0,
};

export function normalizeFillToolSettings(value: unknown): FillToolSettings {
  const raw = value && typeof value === 'object' ? (value as Partial<FillToolSettings>) : {};
  return {
    gapClosePx:
      typeof raw.gapClosePx === 'number' && Number.isFinite(raw.gapClosePx)
        ? Math.max(0, Math.min(64, Math.round(raw.gapClosePx)))
        : DEFAULT_FILL_TOOL_SETTINGS.gapClosePx,
    colorTolerance:
      typeof raw.colorTolerance === 'number' && Number.isFinite(raw.colorTolerance)
        ? Math.max(0, Math.min(100, Math.round(raw.colorTolerance)))
        : DEFAULT_FILL_TOOL_SETTINGS.colorTolerance,
  };
}
