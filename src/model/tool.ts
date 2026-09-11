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
