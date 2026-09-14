import { defaultShortcutBindings } from '../../shortcuts';
import { DEFAULT_SIZE_MM } from '../units';
import type { SavedAppSettings, SavedAppSettingsFile } from './db';
import { SETTINGS_CONTAINER_VERSION } from './version';
import {
  settingsNamespaces,
} from '../settings/namespaces';
import { isPlainObject, type LoadResult } from '../schema';

export interface SettingsDocument {
  version: typeof SETTINGS_CONTAINER_VERSION;
  namespaces: Record<string, { revision: number; data: unknown }>;
}

export interface LoadedAppSettings {
  settings: SavedAppSettings;
  retained: Record<string, { revision: number; data: unknown }>;
  namespaceExtras: Record<string, Record<string, unknown>>;
}

function record(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}

function emptySettings(): SavedAppSettings {
  return {
    tools: [],
    toolLayout: [],
    toolStacks: [],
    activeToolId: null,
    penColor: '#222222',
    penSizeMm: DEFAULT_SIZE_MM,
    colorHistory: [],
    timelapseEnabled: false,
    showEffectRangeGuides: true,
    shortcuts: defaultShortcutBindings(),
  };
}

export function settingsDocumentFromFlat(
  settings: SavedAppSettings,
  retained: Record<string, { revision: number; data: unknown }> = {},
  namespaceExtras: Record<string, Record<string, unknown>> = {},
): SettingsDocument {
  const namespaces: SettingsDocument['namespaces'] = { ...retained };
  for (const namespace of settingsNamespaces()) {
    const data = namespace.fromFlat(settings);
    namespaces[namespace.id] = {
      revision: namespace.revision,
      data: structuredClone({ ...(data as object), ...(namespaceExtras[namespace.id] ?? {}) }),
    };
  }
  return { version: SETTINGS_CONTAINER_VERSION, namespaces };
}

export function loadSettingsDocument(value: unknown): LoadResult<LoadedAppSettings> {
  const raw = record(value);
  if (!raw || !isPlainObject(raw.namespaces) || raw.version !== SETTINGS_CONTAINER_VERSION) {
    return { status: 'invalid', reason: '設定の形式が不正です', raw: value };
  }
  const settings = emptySettings();
  const retained: LoadedAppSettings['retained'] = {};
  const namespaceExtras: LoadedAppSettings['namespaceExtras'] = {};
  const known = new Map(settingsNamespaces().map((namespace) => [namespace.id, namespace]));
  for (const [id, entry] of Object.entries(raw.namespaces)) {
    const namespace = known.get(id);
    const packed = record(entry);
    if (!packed || typeof packed.revision !== 'number') {
      return { status: 'invalid', reason: '設定名前空間の形式が不正です', raw: value };
    }
    if (!namespace || packed.revision > namespace.revision) {
      retained[id] = { revision: packed.revision, data: packed.data };
      continue;
    }
    const loaded = namespace.load(packed.data);
    if (loaded.status === 'invalid') return loaded;
    if (loaded.status === 'unsupported') {
      retained[id] = { revision: packed.revision, data: packed.data };
      continue;
    }
    Object.assign(settings, namespace.toFlat(loaded.value));
    const extra = namespace.extras(packed.data, loaded.value);
    if (Object.keys(extra).length) namespaceExtras[id] = extra;
  }
  return { status: 'ok', value: { settings, retained, namespaceExtras } };
}

export function validateAppSettings(value: unknown): SavedAppSettings {
  const raw = record(value);
  const loaded = loadSettingsDocument(
    raw?.namespaces
      ? value
      : settingsDocumentFromFlat(value as SavedAppSettings),
  );
  if (loaded.status !== 'ok') throw new Error(loaded.reason);
  return loaded.value.settings;
}

export function parseAppSettingsFile(value: unknown): SavedAppSettings {
  return parseAppSettingsFileDetailed(value).settings;
}

export function parseAppSettingsFileDetailed(value: unknown): LoadedAppSettings {
  const file = record(value);
  if (!file || file.app !== 'rin-paint' || file.kind !== 'settings'
    || file.version !== SETTINGS_CONTAINER_VERSION) {
    throw new Error('rin-paint の設定ファイルではありません');
  }
  const loaded = loadSettingsDocument(file);
  if (loaded.status !== 'ok') throw new Error(loaded.reason);
  return loaded.value;
}

export function makeAppSettingsFile(
  settings: SavedAppSettings,
  retained: Record<string, { revision: number; data: unknown }> = {},
  namespaceExtras: Record<string, Record<string, unknown>> = {},
): SavedAppSettingsFile {
  const document = settingsDocumentFromFlat(settings, retained, namespaceExtras);
  return {
    app: 'rin-paint',
    kind: 'settings',
    version: SETTINGS_CONTAINER_VERSION,
    settings,
    namespaces: document.namespaces,
  };
}
