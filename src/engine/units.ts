/** 1 inch = 25.4 mm. Drawing intermediate values keep fractional pixels. */

/** Default brush / stroke width: 14px @ 300ppi. */
export const DEFAULT_SIZE_MM = 1.19;

export const SIZE_MM_MIN = 0.01;
export const SIZE_MM_MAX = 20;
export const SPLIT_WIDTH_MM_MAX = 20;
export const GAP_CLOSE_MM_MAX = 10;

export function mmToPx(mm: number, ppi: number): number {
  return mm * ppi / 25.4;
}

export function pxToMm(px: number, ppi: number): number {
  return px * 25.4 / ppi;
}

/** Round to 2 decimal places for display / commit. */
export function roundMm(mm: number): number {
  return Math.round(mm * 100) / 100;
}

export function formatMm(mm: number): string {
  return roundMm(mm).toFixed(2);
}

export function clampSizeMm(mm: number): number {
  return Math.max(SIZE_MM_MIN, Math.min(SIZE_MM_MAX, mm));
}

export function clampSplitWidthMm(mm: number): number {
  return Math.max(0, Math.min(SPLIT_WIDTH_MM_MAX, mm));
}

export function clampGapCloseMm(mm: number): number {
  return Math.max(0, Math.min(GAP_CLOSE_MM_MAX, mm));
}

/** Integer px for fill gap closing; positive mm yields at least 1px. */
export function gapCloseMmToPx(mm: number, ppi: number): number {
  if (mm <= 0) return 0;
  return Math.max(1, Math.round(mmToPx(mm, ppi)));
}
