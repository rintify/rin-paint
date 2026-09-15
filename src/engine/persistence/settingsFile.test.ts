import { describe, expect, it } from 'vitest';
import type { SavedAppSettings, SavedAppSettingsFile } from './db';
import { makeAppSettingsFile, parseAppSettingsFile, parseAppSettingsFileDetailed, validateAppSettings } from './settingsFile';
import { SETTINGS_CONTAINER_VERSION } from './version';
import { SETTINGS_NAMESPACE_IDS } from '../modules/ids';
import { defaultShortcutBindings } from '../../shortcuts';
import { registerSettingsNamespace, unregisterSettingsNamespace } from '../settings/namespaces';

function settings(): SavedAppSettings {
  return {
    tools: [
      { id: 'select', kind: 'lasso', name: '選択', sizeMm: 1, color: '#112233' },
      { id: 'blur', kind: 'blur', name: 'ぼかし', sizeMm: 2.5, color: 'transparent' },
    ],
    toolLayout: [{ type: 'stack', stackId: 'favorites' }],
    toolStacks: [{ id: 'favorites', name: 'よく使う', toolIds: ['select', 'blur'] }],
    activeToolId: 'select',
    penColor: '#112233',
    penSizeMm: 1,
    colorHistory: ['#112233', '#abcdef'],
    timelapseEnabled: false,
    showEffectRangeGuides: true,
    autoLinkOnPaste: false,
    shortcuts: defaultShortcutBindings(),
  };
}

describe('app settings file', () => {
  it('round-trips namespaced app settings', () => {
    const file = makeAppSettingsFile(settings());
    expect(parseAppSettingsFile(file)).toEqual(settings());
    expect(file.version).toBe(SETTINGS_CONTAINER_VERSION);
    expect(file.app).toBe('rin-paint');
    expect(file.kind).toBe('settings');
    expect(file.namespaces?.[SETTINGS_NAMESPACE_IDS.tools]).toBeTruthy();
    expect(JSON.stringify(file)).not.toMatch(/pageOrder|fonts|rootLayerIds|activeLayerId|referenceImage/i);
  });

  it('round-trips tool shortcuts and rejects duplicate or modified assignments', () => {
    const value = settings();
    value.tools[0].shortcut = 'Slash';
    expect(parseAppSettingsFile(JSON.parse(JSON.stringify(makeAppSettingsFile(value))))).toEqual(value);
    value.tools[1].shortcut = 'Slash';
    expect(() => validateAppSettings(value)).toThrow();
    value.tools[1].shortcut = 'Shift+KeyA';
    expect(() => validateAppSettings(value)).toThrow();
  });

  it('keeps existing layouts that do not include a cursor tool', () => {
    expect(validateAppSettings(settings()).tools.map(tool => tool.kind)).toEqual(['lasso', 'blur']);
  });

  it('fills a missing view flag from load defaults', () => {
    const file = makeAppSettingsFile(settings());
    const view = file.namespaces![SETTINGS_NAMESPACE_IDS.view]!;
    const data = { ...(view.data as Record<string, unknown>) };
    delete data.showEffectRangeGuides;
    view.data = data;
    expect(parseAppSettingsFile(file).showEffectRangeGuides).toBe(true);
  });

  it('defaults automatic paste linking to off when the setting is missing', () => {
    const file = makeAppSettingsFile(settings());
    const preferences = file.namespaces![SETTINGS_NAMESPACE_IDS.preferences]!;
    const data = { ...(preferences.data as Record<string, unknown>) };
    delete data.autoLinkOnPaste;
    preferences.data = data;
    expect(parseAppSettingsFile(file).autoLinkOnPaste).toBe(false);
  });

  it('keeps an unknown tool unusable without dropping it', () => {
    const file = makeAppSettingsFile(settings());
    file.settings.tools[0]!.kind = 'unknown';
    file.namespaces![SETTINGS_NAMESPACE_IDS.tools]!.data = {
      ...(file.namespaces![SETTINGS_NAMESPACE_IDS.tools]!.data as object),
      tools: file.settings.tools,
    };
    const loaded = parseAppSettingsFile(file);
    expect(loaded.tools[0]?.kind).toBe('unknown');
  });

  it('accepts a per-tool auto-deselect flag', () => {
    const value = settings();
    value.tools.push({
      id: 'cursor', kind: 'cursor', name: 'カーソル', sizeMm: 1, color: '#112233',
      settings: { autoDeactivateAfterUse: false },
    });
    value.toolLayout = [...value.toolLayout, { type: 'tool', toolId: 'cursor' }];
    expect(validateAppSettings(value).tools.at(-1)).toMatchObject({
      kind: 'cursor', settings: { autoDeactivateAfterUse: false },
    });
  });

  it('accepts a cursor tool instance without extra settings', () => {
    const value = settings();
    value.tools.push({ id: 'cursor', kind: 'cursor', name: 'カーソル', sizeMm: 1, color: '#112233', settings: { autoDeactivateAfterUse: true } });
    value.toolLayout = [...value.toolLayout, { type: 'tool', toolId: 'cursor' }];
    expect(validateAppSettings(value).tools.map(tool => tool.kind)).toEqual(['lasso', 'blur', 'cursor']);
  });

  it('preserves an unknown settings namespace without touching known values', () => {
    const file = makeAppSettingsFile(settings());
    file.namespaces!.future = { revision: 1, data: { hello: true } };
    const loaded = parseAppSettingsFile(file);
    expect(loaded.penColor).toBe('#112233');
    expect(makeAppSettingsFile(loaded, { future: { revision: 1, data: { hello: true } } }).namespaces?.future).toEqual({
      revision: 1, data: { hello: true },
    });
  });

  it.each([
    ['wrong version', (file: SavedAppSettingsFile) => { (file as { version: number }).version = 1; }],
    ['duplicate tool id', (file: SavedAppSettingsFile) => { file.settings.tools[1]!.id = 'select'; }],
    ['dangling active tool', (file: SavedAppSettingsFile) => { file.settings.activeToolId = 'missing'; }],
    ['dangling stack member', (file: SavedAppSettingsFile) => { file.settings.toolStacks[0]!.toolIds[1] = 'missing'; }],
    ['duplicate stack member', (file: SavedAppSettingsFile) => { file.settings.toolStacks[0]!.toolIds[1] = 'select'; }],
    ['missing layout item', (file: SavedAppSettingsFile) => { file.settings.toolLayout = []; }],
    ['invalid color', (file: SavedAppSettingsFile) => { file.settings.colorHistory[0] = 'red'; }],
    ['out-of-range size', (file: SavedAppSettingsFile) => { file.settings.tools[0]!.sizeMm = 999; }],
    ['duplicate shortcut', (file: SavedAppSettingsFile) => { file.settings.shortcuts['view.reset'] = file.settings.shortcuts['history.undo']; }],
  ])('rejects %s without returning a partial value', (_label, mutate) => {
    const file = structuredClone(makeAppSettingsFile(settings()));
    mutate(file);
    if (file.namespaces) {
      file.namespaces = makeAppSettingsFile(file.settings).namespaces;
    }
    expect(() => parseAppSettingsFile(file)).toThrow();
  });

  it('registers a probe namespace without changing the save service', () => {
    registerSettingsNamespace({
      id: 'rin.settings.probe',
      revision: 1,
      loadDefaults: { enabled: true },
      fromFlat: () => ({ enabled: true }),
      toFlat: () => ({}),
      load: (raw) => {
        const enabled = !raw || typeof raw !== 'object' || (raw as { enabled?: unknown }).enabled === undefined
          ? true
          : (raw as { enabled: unknown }).enabled;
        return typeof enabled === 'boolean'
          ? { status: 'ok', value: { enabled } }
          : { status: 'invalid', reason: 'probe', raw };
      },
      extras: () => ({}),
    });
    try {
      const file = makeAppSettingsFile(settings());
      expect(file.namespaces?.['rin.settings.probe']).toEqual({ revision: 1, data: { enabled: true } });
    } finally {
      unregisterSettingsNamespace('rin.settings.probe');
    }
  });
});

it('retains a newer known namespace across edits and repeated saves', () => {
  const file = makeAppSettingsFile(settings());
  const retained = { revision: 999, data: { future: { enabled: false, value: 0 } } };
  file.namespaces![SETTINGS_NAMESPACE_IDS.tools] = retained;
  const loaded = parseAppSettingsFileDetailed(file);
  loaded.settings.showEffectRangeGuides = false;
  const saved = makeAppSettingsFile(loaded.settings, loaded.retained, loaded.namespaceExtras);
  expect(saved.namespaces![SETTINGS_NAMESPACE_IDS.tools]).toEqual(retained);
  const reloaded = parseAppSettingsFileDetailed(saved);
  expect(reloaded.settings.showEffectRangeGuides).toBe(false);
  expect(makeAppSettingsFile(reloaded.settings, reloaded.retained).namespaces![SETTINGS_NAMESPACE_IDS.tools]).toEqual(retained);
});
