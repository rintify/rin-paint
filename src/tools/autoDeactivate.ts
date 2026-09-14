/** ワンショットツール共通。未指定はオン。 */
export const DEFAULT_AUTO_DEACTIVATE_AFTER_USE = true;

export function normalizeAutoDeactivateAfterUse(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object') return DEFAULT_AUTO_DEACTIVATE_AFTER_USE;
  return (settings as { autoDeactivateAfterUse?: unknown }).autoDeactivateAfterUse !== false;
}

export function settingsIncludeAutoDeactivate(settings: unknown): boolean {
  return !!settings && typeof settings === 'object' && 'autoDeactivateAfterUse' in settings;
}
