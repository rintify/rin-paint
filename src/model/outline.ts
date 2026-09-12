export interface OutlineParams {
  color: string;
  widthMm: number;
  alphaThreshold: number;
  cornerStyle?: 'round' | 'sharp';
}

export const DEFAULT_OUTLINE: OutlineParams = {
  color: '#000000',
  widthMm: 1,
  alphaThreshold: 0.5,
  cornerStyle: 'round',
};
