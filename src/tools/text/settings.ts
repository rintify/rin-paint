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
