export interface PenDetailSettings {
  /** 筆圧の平滑化量 (0 = 補正なし、100 = 最大) */
  pressureStabilization: number;
  /** ストローク始端を細くする量 (0 = なし、100 = 最大) */
  taperIn: number;
  /** ストローク終端を細くする量 (0 = なし、100 = 最大) */
  taperOut: number;
}

export const DEFAULT_PEN_DETAIL_SETTINGS: PenDetailSettings = {
  pressureStabilization: 50,
  taperIn: 0,
  taperOut: 0,
};

export function normalizePenDetailSettings(value: unknown): PenDetailSettings {
  const raw =
    value && typeof value === 'object'
      ? (value as Partial<Record<keyof PenDetailSettings, unknown>>)
      : {};
  const numberInRange = (candidate: unknown, fallback: number) =>
    typeof candidate === 'number' && Number.isFinite(candidate)
      ? Math.max(0, Math.min(100, Math.round(candidate)))
      : fallback;
  return {
    pressureStabilization: numberInRange(
      raw.pressureStabilization,
      DEFAULT_PEN_DETAIL_SETTINGS.pressureStabilization,
    ),
    taperIn: numberInRange(raw.taperIn, DEFAULT_PEN_DETAIL_SETTINGS.taperIn),
    taperOut: numberInRange(raw.taperOut, DEFAULT_PEN_DETAIL_SETTINGS.taperOut),
  };
}
