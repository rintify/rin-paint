export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'lighter'
  | 'difference';

export const BLEND_OPTIONS: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: '通常' },
  { value: 'multiply', label: '乗算' },
  { value: 'screen', label: 'スクリーン' },
  { value: 'overlay', label: 'オーバーレイ' },
  { value: 'darken', label: '比較(暗)' },
  { value: 'lighten', label: '比較(明)' },
  { value: 'lighter', label: '加算' },
  { value: 'difference', label: '差の絶対値' },
];
