/** 色調補正レイヤーのパラメータ (100 = 変化なし, hue は度数) */
export interface AdjustParams {
  brightness: number;
  contrast: number;
  hue: number;
  saturation: number;
}

export const DEFAULT_ADJUST: AdjustParams = {
  brightness: 100,
  contrast: 100,
  hue: 0,
  saturation: 100,
};
