import { z } from 'zod';
import { SETTINGS_NAMESPACE_IDS } from '../modules/ids';
import { SIZE_MM_MAX, SIZE_MM_MIN, DEFAULT_SIZE_MM } from '../units';
import type { SavedAppSettings } from '../persistence/db';
import { fillMissing, isPlainObject, type LoadResult } from '../schema';
import { isToolKind, normalizeToolInstance } from '../../tools/registry';
import { isToolShortcut, defaultShortcutBindings, loadShortcutBindings, type ShortcutBindings } from '../../shortcuts';
import type { ToolInstance, ToolLayoutItem, ToolStack } from '../../model';

export interface SettingsNamespace<T> {
  id: string;
  revision: number;
  loadDefaults: T;
  fromFlat(settings: SavedAppSettings): T;
  toFlat(value: T): Partial<SavedAppSettings>;
  load(raw: unknown): LoadResult<T>;
  extras(raw: unknown, value: T): Record<string, unknown>;
}

const extrasList: SettingsNamespace<unknown>[] = [];

export function settingsNamespaces(): SettingsNamespace<unknown>[] {
  return extrasList.length
    ? [...builtins, ...extrasList]
    : builtins;
}

export function registerSettingsNamespace(namespace: SettingsNamespace<unknown>): void {
  extrasList.push(namespace);
}

export function unregisterSettingsNamespace(id: string): void {
  const index = extrasList.findIndex((item) => item.id === id);
  if (index >= 0) extrasList.splice(index, 1);
}

function record(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}

function isColor(value: unknown): value is string {
  return value === 'transparent' || (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value));
}

function extrasOf(loadDefaults: object, raw: unknown): Record<string, unknown> {
  const source = record(raw);
  if (!source) return {};
  const extras: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (!Object.prototype.hasOwnProperty.call(loadDefaults, key)) extras[key] = source[key];
  }
  return extras;
}

function loadKnown<T>(schema: z.ZodType<T>, loadDefaults: T, raw: unknown): LoadResult<T> {
  const filled = fillMissing(loadDefaults, raw);
  const parsed = schema.safeParse(filled);
  if (!parsed.success) return { status: 'invalid', reason: '保存データの値が不正です', raw };
  return { status: 'ok', value: parsed.data };
}

function readTool(raw: unknown): LoadResult<ToolInstance> {
  const tool = record(raw);
  if (!tool || typeof tool.id !== 'string' || !tool.id || typeof tool.name !== 'string'
    || typeof tool.sizeMm !== 'number' || !Number.isFinite(tool.sizeMm)
    || tool.sizeMm < SIZE_MM_MIN || tool.sizeMm > SIZE_MM_MAX
    || typeof tool.kind !== 'string' || !isColor(tool.color)
    || (tool.shortcut !== undefined && !isToolShortcut(tool.shortcut))) {
    return { status: 'invalid', reason: 'ツールの形式が不正です', raw };
  }
  if (!isToolKind(tool.kind)) {
    return {
      status: 'ok',
      value: {
        id: tool.id,
        kind: tool.kind,
        name: tool.name,
        sizeMm: tool.sizeMm,
        color: tool.color,
        ...(tool.shortcut ? { shortcut: tool.shortcut as string } : {}),
        ...(tool.settings !== undefined ? { settings: tool.settings } : {}),
      },
    };
  }
  const normalized = normalizeToolInstance(raw);
  if (!normalized) return { status: 'invalid', reason: 'ツール固有設定の形式が不正です', raw };
  const settings = record(tool.settings);
  const normalizedSettings = record(normalized.settings as unknown);
  if (settings && normalizedSettings) {
    return {
      status: 'ok',
      value: {
        ...normalized,
        settings: { ...settings, ...normalizedSettings },
      },
    };
  }
  return { status: 'ok', value: normalized };
}

export interface ToolsSettings {
  tools: ToolInstance[];
  toolLayout: ToolLayoutItem[];
  toolStacks: ToolStack[];
  activeToolId: string | null;
}

function loadTools(raw: unknown): LoadResult<ToolsSettings> {
  const source = record(raw);
  if (!source) return { status: 'invalid', reason: 'ツール設定の形式が不正です', raw };
  const filled = fillMissing(toolsNamespace.loadDefaults, source) as ToolsSettings & Record<string, unknown>;
  if (!Array.isArray(filled.tools) || !Array.isArray(filled.toolLayout) || !Array.isArray(filled.toolStacks)) {
    return { status: 'invalid', reason: 'ツール設定の形式が不正です', raw };
  }
  const tools: ToolInstance[] = [];
  for (const item of filled.tools) {
    const loaded = readTool(item);
    if (loaded.status !== 'ok') return loaded;
    tools.push(loaded.value);
  }
  const bindings = tools.map(tool => tool.shortcut).filter(Boolean);
  if (new Set(bindings).size !== bindings.length) {
    return { status: 'invalid', reason: 'ツールのショートカットが重複しています', raw };
  }
  const toolIds = new Set(tools.map((tool) => tool.id));
  if (toolIds.size !== tools.length) return { status: 'invalid', reason: 'ツールIDが重複しています', raw };

  const stackIds = new Set<string>();
  const stackedTools = new Set<string>();
  const toolStacks: ToolStack[] = [];
  for (const value of filled.toolStacks) {
    const stack = record(value);
    const localIds = Array.isArray(stack?.toolIds) ? new Set(stack.toolIds) : null;
    if (!stack || typeof stack.id !== 'string' || !stack.id || typeof stack.name !== 'string'
      || !Array.isArray(stack.toolIds) || stack.toolIds.length < 2
      || localIds?.size !== stack.toolIds.length
      || stack.toolIds.some((id) => typeof id !== 'string' || !toolIds.has(id) || stackedTools.has(id))) {
      return { status: 'invalid', reason: 'ツールスタックの形式が不正です', raw };
    }
    if (stackIds.has(stack.id)) return { status: 'invalid', reason: 'スタックIDが重複しています', raw };
    stackIds.add(stack.id);
    for (const id of stack.toolIds as string[]) stackedTools.add(id);
    toolStacks.push({ id: stack.id, name: stack.name, toolIds: [...stack.toolIds] as string[] });
  }

  const seenTools = new Set<string>();
  const seenStacks = new Set<string>();
  const toolLayout: ToolLayoutItem[] = [];
  for (const value of filled.toolLayout) {
    const item = record(value);
    if (item?.type === 'tool' && typeof item.toolId === 'string' && toolIds.has(item.toolId)
      && !stackedTools.has(item.toolId) && !seenTools.has(item.toolId)) {
      seenTools.add(item.toolId);
      toolLayout.push({ type: 'tool', toolId: item.toolId });
      continue;
    }
    if (item?.type === 'stack' && typeof item.stackId === 'string' && stackIds.has(item.stackId)
      && !seenStacks.has(item.stackId)) {
      seenStacks.add(item.stackId);
      toolLayout.push({ type: 'stack', stackId: item.stackId });
      continue;
    }
    return { status: 'invalid', reason: 'ツール配置の形式が不正です', raw };
  }
  if (seenTools.size + stackedTools.size !== toolIds.size || seenStacks.size !== stackIds.size) {
    return { status: 'invalid', reason: 'ツール配置に不足があります', raw };
  }
  const activeToolId = filled.activeToolId;
  if (activeToolId !== null && (typeof activeToolId !== 'string' || !toolIds.has(activeToolId))) {
    return { status: 'invalid', reason: 'アクティブツールが不正です', raw };
  }
  return {
    status: 'ok',
    value: { tools, toolLayout, toolStacks, activeToolId },
  };
}

const colorSchema = z.object({
  penColor: z.string().refine(isColor),
  penSizeMm: z.number().finite().min(SIZE_MM_MIN).max(SIZE_MM_MAX),
  colorHistory: z.array(z.string().refine(isColor)).max(24),
});

const viewSchema = z.object({
  timelapseEnabled: z.boolean(),
  showEffectRangeGuides: z.boolean(),
});

export const toolsNamespace: SettingsNamespace<ToolsSettings> = {
  id: SETTINGS_NAMESPACE_IDS.tools,
  revision: 1,
  loadDefaults: {
    tools: [],
    toolLayout: [],
    toolStacks: [],
    activeToolId: null,
  },
  fromFlat: (settings) => ({
    tools: settings.tools,
    toolLayout: settings.toolLayout,
    toolStacks: settings.toolStacks,
    activeToolId: settings.activeToolId,
  }),
  toFlat: (value) => ({
    tools: value.tools,
    toolLayout: value.toolLayout,
    toolStacks: value.toolStacks,
    activeToolId: value.activeToolId,
  }),
  load: loadTools,
  extras: (raw, value) => extrasOf(value, raw),
};

export const colorsNamespace: SettingsNamespace<z.infer<typeof colorSchema>> = {
  id: SETTINGS_NAMESPACE_IDS.colors,
  revision: 1,
  loadDefaults: {
    penColor: '#222222',
    penSizeMm: DEFAULT_SIZE_MM,
    colorHistory: [],
  },
  fromFlat: (settings) => ({
    penColor: settings.penColor,
    penSizeMm: settings.penSizeMm,
    colorHistory: [...settings.colorHistory],
  }),
  toFlat: (value) => ({
    penColor: value.penColor,
    penSizeMm: value.penSizeMm,
    colorHistory: [...value.colorHistory],
  }),
  load: (raw) => loadKnown(colorSchema, colorsNamespace.loadDefaults, raw),
  extras: (raw) => extrasOf(colorsNamespace.loadDefaults, raw),
};

export const viewNamespace: SettingsNamespace<z.infer<typeof viewSchema>> = {
  id: SETTINGS_NAMESPACE_IDS.view,
  revision: 1,
  loadDefaults: {
    timelapseEnabled: false,
    showEffectRangeGuides: true,
  },
  fromFlat: (settings) => ({
    timelapseEnabled: settings.timelapseEnabled,
    showEffectRangeGuides: settings.showEffectRangeGuides,
  }),
  toFlat: (value) => ({
    timelapseEnabled: value.timelapseEnabled,
    showEffectRangeGuides: value.showEffectRangeGuides,
  }),
  load: (raw) => loadKnown(viewSchema, viewNamespace.loadDefaults, raw),
  extras: (raw) => extrasOf(viewNamespace.loadDefaults, raw),
};

export const shortcutsNamespace: SettingsNamespace<ShortcutBindings> = {
  id: SETTINGS_NAMESPACE_IDS.shortcuts,
  revision: 1,
  loadDefaults: defaultShortcutBindings(),
  fromFlat: (settings) => ({ ...settings.shortcuts }),
  toFlat: (value) => ({ shortcuts: { ...value } }),
  load: loadShortcutBindings,
  extras: (raw, value) => extrasOf(value, raw),
};

const builtins: SettingsNamespace<unknown>[] = [
  toolsNamespace as SettingsNamespace<unknown>,
  colorsNamespace as SettingsNamespace<unknown>,
  viewNamespace as SettingsNamespace<unknown>,
  shortcutsNamespace as SettingsNamespace<unknown>,
];
