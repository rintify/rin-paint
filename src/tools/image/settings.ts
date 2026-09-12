import { mmToPx, roundMm } from '../../engine/units';

export interface ImageToolSettings {
  widthMm: number;
  heightMm: number;
}

export const DEFAULT_IMAGE_TOOL_SETTINGS: ImageToolSettings = {
  widthMm: 50,
  heightMm: 50,
};

export const IMAGE_SIZE_MM_MIN = 0.01;
export const IMAGE_SIZE_MM_MAX = 1000;

function clampImageMm(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_IMAGE_TOOL_SETTINGS.widthMm;
  return Math.max(IMAGE_SIZE_MM_MIN, Math.min(IMAGE_SIZE_MM_MAX, value));
}

export function normalizeImageToolSettings(value: unknown): ImageToolSettings {
  const raw = value && typeof value === 'object' ? value as Partial<ImageToolSettings> : {};
  return {
    widthMm: roundMm(clampImageMm(Number(raw.widthMm))),
    heightMm: roundMm(clampImageMm(Number(raw.heightMm))),
  };
}

export function imageToolBoxPx(settings: unknown, ppi: number): { width: number; height: number } {
  const value = normalizeImageToolSettings(settings);
  return { width: mmToPx(value.widthMm, ppi), height: mmToPx(value.heightMm, ppi) };
}
