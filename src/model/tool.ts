import type { ShapePaintMode } from './shape';

export type ToolKind =
  | 'pen'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'fill'
  | 'polygonSplit'
  | 'lasso'
  | 'blur'
  | 'text';

export const TOOL_KIND_LABELS: Record<ToolKind, string> = {
  pen: 'ペン',
  line: '直線',
  rect: '四角',
  ellipse: '楕円',
  polygon: '多角形',
  fill: '塗りつぶし',
  polygonSplit: '多角形分断',
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
  fillSettings?: FillToolSettings;
  shapeSettings?: ShapeToolSettings;
  polygonSplitSettings?: PolygonSplitToolSettings;
}

export interface ToolStack {
  id: string;
  name: string;
  toolIds: string[];
}

export type ToolLayoutItem =
  | { type: 'tool'; toolId: string }
  | { type: 'stack'; stackId: string };

export function newToolStackId(): string {
  return `TS${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

export interface TextToolSettings {
  fontId: string;
  sizePt: number;
  direction: 'horizontal' | 'vertical';
  lineHeight: number;
}

export interface FillToolSettings {
  gapClosePx: number;
  colorTolerance: number;
}

export interface ShapeToolSettings {
  paintMode: ShapePaintMode;
}

export interface PolygonSplitToolSettings {
  width: number;
}

export const DEFAULT_FILL_TOOL_SETTINGS: FillToolSettings = {
  gapClosePx: 0,
  colorTolerance: 0,
};

export const DEFAULT_SHAPE_TOOL_SETTINGS: ShapeToolSettings = {
  paintMode: 'stroke',
};

export const DEFAULT_POLYGON_SPLIT_TOOL_SETTINGS: PolygonSplitToolSettings = {
  width: 0,
};

export function normalizeFillToolSettings(value: unknown): FillToolSettings {
  const raw = value && typeof value === 'object' ? value as Partial<FillToolSettings> : {};
  return {
    gapClosePx: typeof raw.gapClosePx === 'number' && Number.isFinite(raw.gapClosePx)
      ? Math.max(0, Math.min(64, Math.round(raw.gapClosePx)))
      : DEFAULT_FILL_TOOL_SETTINGS.gapClosePx,
    colorTolerance:
      typeof raw.colorTolerance === 'number' && Number.isFinite(raw.colorTolerance)
        ? Math.max(0, Math.min(100, Math.round(raw.colorTolerance)))
        : DEFAULT_FILL_TOOL_SETTINGS.colorTolerance,
  };
}

export function normalizeShapeToolSettings(value: unknown): ShapeToolSettings {
  const raw = value && typeof value === 'object' ? value as Partial<ShapeToolSettings> : {};
  return {
    paintMode:
      raw.paintMode === 'fill-inside' || raw.paintMode === 'fill-outside'
        ? raw.paintMode
        : 'stroke',
  };
}

export function normalizePolygonSplitToolSettings(value: unknown): PolygonSplitToolSettings {
  const raw = value && typeof value === 'object'
    ? value as Partial<PolygonSplitToolSettings>
    : {};
  return {
    width: typeof raw.width === 'number' && Number.isFinite(raw.width)
      ? Math.max(0, Math.min(128, raw.width))
      : DEFAULT_POLYGON_SPLIT_TOOL_SETTINGS.width,
  };
}

export const DEFAULT_TEXT_TOOL_SETTINGS: TextToolSettings = {
  fontId: 'sans',
  sizePt: 12,
  direction: 'horizontal',
  lineHeight: 1.5,
};

export function normalizeTextToolSettings(value: unknown): TextToolSettings {
  const raw = value && typeof value === 'object' ? (value as Partial<TextToolSettings>) : {};
  return {
    fontId: typeof raw.fontId === 'string' && raw.fontId ? raw.fontId : DEFAULT_TEXT_TOOL_SETTINGS.fontId,
    sizePt:
      typeof raw.sizePt === 'number' && Number.isFinite(raw.sizePt)
        ? Math.max(1, Math.min(512, raw.sizePt))
        : DEFAULT_TEXT_TOOL_SETTINGS.sizePt,
    direction: raw.direction === 'vertical' ? 'vertical' : 'horizontal',
    lineHeight:
      typeof raw.lineHeight === 'number' && Number.isFinite(raw.lineHeight)
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
