import { describe, expect, it } from 'vitest';
import type { SavedAppSettings, SavedAppSettingsFile } from './db';
import { makeAppSettingsFile, parseAppSettingsFile, validateAppSettings } from './settingsFile';
import { defaultShortcutBindings } from '../../shortcuts';

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
    shortcuts: defaultShortcutBindings(),
  };
}

describe('app settings file', () => {
  it('round-trips only the app settings envelope', () => {
    const file = makeAppSettingsFile(settings());
    expect(parseAppSettingsFile(file)).toEqual(settings());
    expect(file).toEqual({ app: 'rin-paint', kind: 'settings', version: 1, settings: settings() });
    expect(JSON.stringify(file)).not.toMatch(/pageOrder|fonts|rootLayerIds|activeLayerId|referenceImage/i);
  });

  it('keeps existing layouts that do not include a cursor tool', () => {
    expect(validateAppSettings(settings()).tools.map(tool => tool.kind)).toEqual(['lasso', 'blur']);
  });

  it('ignores a legacy app-wide auto-deselect flag', () => {
    const value = { ...settings(), autoDeselectPaletteTools: false };
    expect(validateAppSettings(value)).toEqual(settings());
  });

  it('accepts a per-tool auto-deselect flag', () => {
    const value = settings();
    value.tools.push({
      id: 'cursor', kind: 'cursor', name: 'カーソル', sizeMm: 1, color: '#112233',
      autoDeactivateAfterUse: false,
    });
    value.toolLayout = [...value.toolLayout, { type: 'tool', toolId: 'cursor' }];
    expect(validateAppSettings(value).tools.at(-1)).toMatchObject({
      kind: 'cursor', autoDeactivateAfterUse: false,
    });
  });

  it('accepts a cursor tool instance without extra settings', () => {
    const value = settings();
    value.tools.push({ id: 'cursor', kind: 'cursor', name: 'カーソル', sizeMm: 1, color: '#112233' });
    value.toolLayout = [...value.toolLayout, { type: 'tool', toolId: 'cursor' }];
    expect(validateAppSettings(value).tools.map(tool => tool.kind)).toEqual(['lasso', 'blur', 'cursor']);
  });

  it.each([
    ['wrong version', (file: SavedAppSettingsFile) => { (file as { version: number }).version = 2; }],
    ['unknown tool', (file: SavedAppSettingsFile) => { file.settings.tools[0]!.kind = 'unknown'; }],
    ['duplicate tool id', (file: SavedAppSettingsFile) => { file.settings.tools[1]!.id = 'select'; }],
    ['dangling active tool', (file: SavedAppSettingsFile) => { file.settings.activeToolId = 'missing'; }],
    ['dangling stack member', (file: SavedAppSettingsFile) => { file.settings.toolStacks[0]!.toolIds[1] = 'missing'; }],
    ['duplicate stack member', (file: SavedAppSettingsFile) => { file.settings.toolStacks[0]!.toolIds[1] = 'select'; }],
    ['missing layout item', (file: SavedAppSettingsFile) => { file.settings.toolLayout = []; }],
    ['invalid color', (file: SavedAppSettingsFile) => { file.settings.colorHistory[0] = 'red'; }],
    ['out-of-range size', (file: SavedAppSettingsFile) => { file.settings.tools[0]!.sizeMm = 999; }],
    ['unexpected tool setting', (file: SavedAppSettingsFile) => { file.settings.tools[0]!.settings = { surprise: true }; }],
    ['duplicate shortcut', (file: SavedAppSettingsFile) => { file.settings.shortcuts['view.reset'] = file.settings.shortcuts['history.undo']; }],
  ])('rejects %s without returning a partial value', (_label, mutate) => {
    const file = structuredClone(makeAppSettingsFile(settings()));
    mutate(file);
    expect(() => parseAppSettingsFile(file)).toThrow();
  });

  it('rejects clamped tool-specific values instead of silently changing imported data', () => {
    const value = settings();
    value.tools = [{
      id: 'pen', kind: 'pen', name: 'ペン', sizeMm: 1, color: '#000000',
      settings: { pressureStabilization: 101, taperIn: 0, taperOut: 0 },
    }];
    value.toolLayout = [{ type: 'tool', toolId: 'pen' }];
    value.toolStacks = [];
    value.activeToolId = 'pen';
    expect(() => validateAppSettings(value)).toThrow('ツール固有設定');
  });
});
