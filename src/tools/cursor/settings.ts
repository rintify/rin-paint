export type CursorToolSettings = Record<string, never>;

export const DEFAULT_CURSOR_TOOL_SETTINGS: CursorToolSettings = {};

export function normalizeCursorToolSettings(_value: unknown): CursorToolSettings {
  return {};
}

/** 明示選択中のカーソル、表示順で最初のカーソル、内蔵既定値の順。 */
export function resolveCursorToolSettings(input: {
  selectedKind: string | null;
  selectedSettings?: unknown;
  firstVisibleCursor?: { settings?: unknown } | null;
}): CursorToolSettings {
  if (input.selectedKind === 'cursor') return normalizeCursorToolSettings(input.selectedSettings);
  if (input.firstVisibleCursor) return normalizeCursorToolSettings(input.firstVisibleCursor.settings);
  return { ...DEFAULT_CURSOR_TOOL_SETTINGS };
}
