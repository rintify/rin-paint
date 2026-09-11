export type ToolKind = 'pen' | 'line' | 'rect' | 'ellipse' | 'lasso' | 'blur' | 'text';

export const TOOL_KIND_LABELS: Record<ToolKind, string> = {
  pen: 'ペン',
  line: '直線',
  rect: '四角',
  ellipse: '楕円',
  lasso: '選択',
  blur: 'ぼかし',
  text: '文字',
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
  /** 文字ツールで新しく作る文字の初期書式。 */
  textSettings?: TextToolSettings;
}

export interface TextToolSettings {
  fontId: string;
  sizePt: number;
  direction: 'horizontal' | 'vertical';
  lineHeight: number;
}

export const DEFAULT_TEXT_TOOL_SETTINGS: TextToolSettings = {
  fontId: 'sans',
  sizePt: 12,
  direction: 'horizontal',
  lineHeight: 1.5,
};

export function normalizeTextToolSettings(value: unknown): TextToolSettings {
  const raw = value && typeof value === 'object' ? value as Partial<TextToolSettings> : {};
  return {
    fontId: typeof raw.fontId === 'string' && raw.fontId ? raw.fontId : DEFAULT_TEXT_TOOL_SETTINGS.fontId,
    sizePt: typeof raw.sizePt === 'number' && Number.isFinite(raw.sizePt)
      ? Math.max(1, Math.min(512, raw.sizePt))
      : DEFAULT_TEXT_TOOL_SETTINGS.sizePt,
    direction: raw.direction === 'vertical' ? 'vertical' : 'horizontal',
    lineHeight: typeof raw.lineHeight === 'number' && Number.isFinite(raw.lineHeight)
      ? Math.max(1, Math.min(5, raw.lineHeight))
      : DEFAULT_TEXT_TOOL_SETTINGS.lineHeight,
  };
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

export type ShapeKind = 'line' | 'rect' | 'ellipse';

export interface LineShapeParams {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export interface RectShapeParams {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
}

export interface EllipseShapeParams {
  kind: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  color: string;
  strokeWidth: number;
}

export type ShapeParams = LineShapeParams | RectShapeParams | EllipseShapeParams;

export type LayerType = 'raster' | 'adjust' | 'shape' | 'text';

export interface TextStyle { fontId: string; color: string; sizePt: number }
export interface TextRange extends TextStyle { start: number; end: number }
export interface RubyRange { start: number; end: number; text: string }
export interface TextParams {
  content: string;
  style: TextStyle;
  ranges: TextRange[];
  ruby: RubyRange[];
  direction: 'horizontal' | 'vertical';
  lineHeight: number;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
}
export interface ProjectFont { id: string; name: string; dataUrl: string }
export interface CanvasSpec { widthMm: number; heightMm: number; ppi: number }
export const DEFAULT_CANVAS: CanvasSpec = { widthMm: 1600 * 25.4 / 300, heightMm: 1200 * 25.4 / 300, ppi: 300 };

/** React 側に渡すレイヤーの読み取り専用メタデータ */
export interface LayerMeta {
  id: string;
  type: LayerType;
  name: string;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  parentId: string | null;
  childIds: string[];
  params?: AdjustParams;
  shape?: ShapeParams;
  text?: TextParams;
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
