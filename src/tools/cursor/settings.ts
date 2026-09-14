import { AutoDeactivateSwitch } from '../AutoDeactivateSwitch';
import { DEFAULT_AUTO_DEACTIVATE_AFTER_USE, normalizeAutoDeactivateAfterUse } from '../autoDeactivate';

export interface CursorToolSettings {
  autoDeactivateAfterUse: boolean;
}

export const DEFAULT_CURSOR_TOOL_SETTINGS: CursorToolSettings = {
  autoDeactivateAfterUse: DEFAULT_AUTO_DEACTIVATE_AFTER_USE,
};

export function normalizeCursorToolSettings(value: unknown): CursorToolSettings {
  return { autoDeactivateAfterUse: normalizeAutoDeactivateAfterUse(value) };
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

export function CursorSettingsPanel() {
  return <AutoDeactivateSwitch />;
}
