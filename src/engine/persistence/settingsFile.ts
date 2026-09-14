import { SIZE_MM_MAX, SIZE_MM_MIN } from '../units';
import { normalizeToolInstance } from '../../tools/registry';
import type { SavedAppSettings, SavedAppSettingsFile } from './db';
import { defaultShortcutBindings, validateShortcutBindings } from '../../shortcuts';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameValue(value, right[index]));
  }
  const a = record(left), b = record(right);
  if (!a || !b) return false;
  const aKeys = Object.keys(a).sort(), bKeys = Object.keys(b).sort();
  return aKeys.length === bKeys.length && aKeys.every((key, index) =>
    key === bKeys[index] && sameValue(a[key], b[key]));
}

function isColor(value: unknown): value is string {
  return value === 'transparent' || (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value));
}

export function validateAppSettings(value: unknown): SavedAppSettings {
  const raw = record(value);
  if (!raw || !Array.isArray(raw.tools) || !Array.isArray(raw.toolLayout) || !Array.isArray(raw.toolStacks)) {
    throw new Error('設定ファイルの形式が不正です');
  }
  const rawTools = raw.tools;
  if (rawTools.some(value => {
    const tool = record(value);
    return !tool || typeof tool.sizeMm !== 'number' || !Number.isFinite(tool.sizeMm)
      || tool.sizeMm < SIZE_MM_MIN || tool.sizeMm > SIZE_MM_MAX;
  })) throw new Error('ツールの太さが範囲外です');
  const tools = rawTools.map(normalizeToolInstance);
  if (tools.some(tool => !tool)) throw new Error('未対応または不正なツールが含まれています');
  const normalizedTools = tools.filter((tool): tool is NonNullable<typeof tool> => !!tool);
  if (normalizedTools.some((tool, index) => !sameValue(tool, rawTools[index]))) {
    throw new Error('ツール固有設定の形式が不正です');
  }
  if (normalizedTools.some(tool => !isColor(tool.color))) throw new Error('ツールの色が不正です');
  const toolIds = new Set(normalizedTools.map(tool => tool.id));
  if (toolIds.size !== normalizedTools.length) throw new Error('ツールIDが重複しています');

  const stackIds = new Set<string>();
  const stackedTools = new Set<string>();
  const toolStacks = raw.toolStacks.map(value => {
    const stack = record(value);
    const localIds = Array.isArray(stack?.toolIds) ? new Set(stack.toolIds) : null;
    if (!stack || typeof stack.id !== 'string' || !stack.id || typeof stack.name !== 'string'
      || !Array.isArray(stack.toolIds) || stack.toolIds.length < 2
      || localIds?.size !== stack.toolIds.length
      || stack.toolIds.some(id => typeof id !== 'string' || !toolIds.has(id) || stackedTools.has(id))) {
      throw new Error('ツールスタックの形式が不正です');
    }
    if (stackIds.has(stack.id)) throw new Error('スタックIDが重複しています');
    stackIds.add(stack.id);
    for (const id of stack.toolIds as string[]) stackedTools.add(id);
    const normalized = { id: stack.id, name: stack.name, toolIds: [...stack.toolIds] as string[] };
    if (!sameValue(normalized, stack)) throw new Error('ツールスタックの形式が不正です');
    return normalized;
  });

  const seenTools = new Set<string>(), seenStacks = new Set<string>();
  const toolLayout = raw.toolLayout.map(value => {
    const item = record(value);
    if (item?.type === 'tool' && typeof item.toolId === 'string' && toolIds.has(item.toolId)
      && !stackedTools.has(item.toolId) && !seenTools.has(item.toolId)) {
      seenTools.add(item.toolId);
      const normalized = { type: 'tool' as const, toolId: item.toolId };
      if (!sameValue(normalized, item)) throw new Error('ツール配置の形式が不正です');
      return normalized;
    }
    if (item?.type === 'stack' && typeof item.stackId === 'string' && stackIds.has(item.stackId)
      && !seenStacks.has(item.stackId)) {
      seenStacks.add(item.stackId);
      const normalized = { type: 'stack' as const, stackId: item.stackId };
      if (!sameValue(normalized, item)) throw new Error('ツール配置の形式が不正です');
      return normalized;
    }
    throw new Error('ツール配置の形式が不正です');
  });
  if (seenTools.size + stackedTools.size !== toolIds.size || seenStacks.size !== stackIds.size) {
    throw new Error('ツール配置に不足があります');
  }
  const activeToolId = raw.activeToolId;
  if (activeToolId !== null && (typeof activeToolId !== 'string' || !toolIds.has(activeToolId))) {
    throw new Error('アクティブツールが不正です');
  }
  if (!isColor(raw.penColor) || typeof raw.penSizeMm !== 'number'
    || !Number.isFinite(raw.penSizeMm) || raw.penSizeMm < SIZE_MM_MIN || raw.penSizeMm > SIZE_MM_MAX
    || !Array.isArray(raw.colorHistory) || raw.colorHistory.length > 24
    || raw.colorHistory.some(color => !isColor(color))
    || typeof raw.timelapseEnabled !== 'boolean') {
    throw new Error('設定値の形式が不正です');
  }
  if (raw.autoDeselectPaletteTools !== undefined && typeof raw.autoDeselectPaletteTools !== 'boolean') {
    throw new Error('設定値の形式が不正です');
  }
  const normalized: SavedAppSettings = {
    tools: normalizedTools,
    toolLayout,
    toolStacks,
    activeToolId,
    penColor: raw.penColor,
    penSizeMm: raw.penSizeMm,
    colorHistory: [...raw.colorHistory] as string[],
    timelapseEnabled: raw.timelapseEnabled,
    shortcuts: raw.shortcuts === undefined ? defaultShortcutBindings() : validateShortcutBindings(raw.shortcuts),
  };
  const assigned = Object.values(normalized.shortcuts).filter(Boolean);
  if (new Set(assigned).size !== assigned.length) throw new Error('ショートカットの割り当てが重複しています');
  const comparable = { ...normalized } as Record<string, unknown>;
  if (raw.shortcuts === undefined) delete comparable.shortcuts;
  const rawComparable = { ...raw };
  delete rawComparable.autoDeselectPaletteTools;
  if (!sameValue(comparable, rawComparable)) throw new Error('設定ファイルに未対応の項目があります');
  return normalized;
}

export function parseAppSettingsFile(value: unknown): SavedAppSettings {
  const file = record(value);
  if (!file || file.app !== 'rin-paint' || file.kind !== 'settings' || file.version !== 1) {
    throw new Error('rin-paint の設定ファイルではありません');
  }
  const settings = validateAppSettings(file.settings);
  const expected = makeAppSettingsFile(settings);
  const rawSettings = record(file.settings);
  if (!rawSettings) throw new Error('設定ファイルの形式が不正です');
  const expectedSettings = { ...expected.settings } as Record<string, unknown>;
  if (rawSettings.shortcuts === undefined) delete expectedSettings.shortcuts;
  const fileSettings = { ...rawSettings };
  delete fileSettings.autoDeselectPaletteTools;
  if (!sameValue(
    { app: expected.app, kind: expected.kind, version: expected.version, settings: expectedSettings },
    { app: file.app, kind: file.kind, version: file.version, settings: fileSettings },
  )) throw new Error('設定ファイルに未対応の項目があります');
  return settings;
}

export function makeAppSettingsFile(settings: SavedAppSettings): SavedAppSettingsFile {
  return { app: 'rin-paint', kind: 'settings', version: 1, settings };
}
