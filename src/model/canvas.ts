export interface CanvasSpec {
  widthMm: number;
  heightMm: number;
  ppi: number;
}

export const DEFAULT_CANVAS: CanvasSpec = {
  widthMm: (1600 * 25.4) / 300,
  heightMm: (1200 * 25.4) / 300,
  ppi: 300,
};

/** ペン色として「透明 (消す)」を表す特別な値 */
export const TRANSPARENT = 'transparent';

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

export const MIN_ART_SIZE = 64;
export const MAX_ART_SIZE = 4096;
