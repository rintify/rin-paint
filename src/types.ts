export type ToolKind = 'pen' | 'line' | 'rect' | 'ellipse' | 'lasso' | 'blur';

export const TOOL_KIND_LABELS: Record<ToolKind, string> = {
  pen: 'ペン',
  line: '直線',
  rect: '四角',
  ellipse: '楕円',
  lasso: '選択',
  blur: 'ぼかし',
};

/**
 * ツールエリアに並ぶ「ツールインスタンス」。
 * 同じ形 (kind) のツールを複数持て、色・太さを個別に記憶する。
 */
export interface ToolInstance {
  id: string;
  kind: ToolKind;
  name: string;
  size: number;
  color: string;
  /** ペン固有の詳細設定。古い保存データとの互換性のため省略可能。 */
  penSettings?: PenDetailSettings;
}

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

let toolIdCounter = 0;
export function newToolInstanceId(): string {
  return `T${Date.now().toString(36)}-${(toolIdCounter++).toString(36)}`;
}

/** ペン色として「透明 (消す)」を表す特別な値 */
export const TRANSPARENT = 'transparent';

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

export type LayerType = 'raster' | 'adjust';

/** React 側に渡すレイヤーの読み取り専用メタデータ */
export interface LayerMeta {
  id: string;
  type: LayerType;
  name: string;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  params?: AdjustParams;
  /** ラスター内容が変わるたびに増える (サムネイル再描画用) */
  version: number;
}

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

/**
 * アートボードの現在サイズ。ES モジュールのライブバインディングなので
 * setArtSize で変更するとインポート先でも常に最新値が読める。
 */
export let ART_W = 1600;
export let ART_H = 1200;

export const MIN_ART_SIZE = 64;
export const MAX_ART_SIZE = 4096;

export function setArtSize(w: number, h: number): void {
  ART_W = Math.round(Math.max(MIN_ART_SIZE, Math.min(MAX_ART_SIZE, w)));
  ART_H = Math.round(Math.max(MIN_ART_SIZE, Math.min(MAX_ART_SIZE, h)));
}
