import { clampGapCloseMm, roundMm } from '../../engine/units';

export interface FillToolSettings {
  gapCloseMm: number;
  colorTolerance: number;
}

export const DEFAULT_FILL_TOOL_SETTINGS: FillToolSettings = {
  gapCloseMm: 0,
  colorTolerance: 0,
};

export function normalizeFillToolSettings(value: unknown): FillToolSettings {
  const raw = value && typeof value === 'object' ? (value as Partial<FillToolSettings>) : {};
  return {
    gapCloseMm:
      typeof raw.gapCloseMm === 'number' && Number.isFinite(raw.gapCloseMm)
        ? roundMm(clampGapCloseMm(raw.gapCloseMm))
        : DEFAULT_FILL_TOOL_SETTINGS.gapCloseMm,
    colorTolerance:
      typeof raw.colorTolerance === 'number' && Number.isFinite(raw.colorTolerance)
        ? Math.max(0, Math.min(100, Math.round(raw.colorTolerance)))
        : DEFAULT_FILL_TOOL_SETTINGS.colorTolerance,
  };
}
