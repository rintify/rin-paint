// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { useStore } from '../../state/store';
import { loadAppSettings, saveAppSettings, type SavedAppSettings } from '../persistence/db';
import { makeAppSettingsFile } from '../persistence/settingsFile';
import type { PaintEngine } from '../PaintEngine';
import { SettingsService } from './SettingsService';
import { defaultShortcutBindings } from '../../shortcuts';

function saved(color = '#123456'): SavedAppSettings {
  return {
    tools: [{ id: 'selection', kind: 'lasso', name: '選択ツール', sizeMm: 2, color }],
    toolLayout: [{ type: 'tool', toolId: 'selection' }],
    toolStacks: [],
    activeToolId: 'selection',
    penColor: '#ffffff',
    penSizeMm: 10,
    colorHistory: [color, '#abcdef'],
    timelapseEnabled: false,
    showEffectRangeGuides: true,
    autoLinkOnPaste: false,
    shortcuts: defaultShortcutBindings(),
  };
}

describe('SettingsService', () => {
  it('restores, replaces, and persists app settings without touching project state', async () => {
    await saveAppSettings(saved());
    const setEnabled = vi.fn();
    const finishFloating = vi.fn();
    const cancel = vi.fn();
    const engine = {
      isBusy: () => false,
      recorderPublic: () => ({ setEnabled }),
      layerService: { finishFloating },
      activeTool: () => ({ cancel }),
      syncActiveToolToLayer() {},
      requestRender: vi.fn(),
      syncStore: vi.fn(),
    } as unknown as PaintEngine;
    const service = new SettingsService(engine);
    const projectLayers = useStore.getState().layers;
    await service.init();
    expect(useStore.getState()).toMatchObject({
      activeToolId: 'selection', tool: 'lasso', penColor: '#123456', penSizeMm: 2,
      colorHistory: ['#123456', '#abcdef'], timelapseEnabled: false,
    });
    expect(useStore.getState().layers).toBe(projectLayers);
    expect(setEnabled).toHaveBeenCalledWith(false);

    useStore.getState().setPenColor('#654321');
    await service.flush();
    expect(await loadAppSettings()).toMatchObject({ penColor: '#654321', tools: [{ color: '#654321' }] });

    const imported = saved('#ff0000');
    const file = new File([JSON.stringify(makeAppSettingsFile(imported))], 'settings.rinsettings');
    await service.importFile(file);
    expect(finishFloating).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(useStore.getState()).toMatchObject({ penColor: '#ff0000', penSizeMm: 2, timelapseEnabled: false });
    expect(useStore.getState().layers).toBe(projectLayers);
    expect(await loadAppSettings()).toMatchObject({ penColor: '#ff0000', penSizeMm: 2 });
  });

  it('does not partially apply an invalid imported file', async () => {
    const engine = {
      isBusy: () => false,
      recorderPublic: () => ({ setEnabled() {} }),
      layerService: { finishFloating: vi.fn() },
      activeTool: () => ({ cancel: vi.fn() }),
      syncActiveToolToLayer() {},
      requestRender: vi.fn(),
      syncStore: vi.fn(),
    } as unknown as PaintEngine;
    const service = new SettingsService(engine);
    await service.init();
    const before = service.snapshot();
    const malformed = makeAppSettingsFile(saved());
    malformed.settings.activeToolId = 'missing';
    const tools = malformed.namespaces!['rin.settings.tools'];
    if (tools && tools.data && typeof tools.data === 'object') {
      (tools.data as { activeToolId: string }).activeToolId = 'missing';
    }
    await expect(service.importFile(new File([JSON.stringify(malformed)], 'bad.rinsettings'))).rejects.toThrow();
    expect(service.snapshot()).toEqual(before);
    expect(engine.layerService.finishFloating).not.toHaveBeenCalled();
  });
});
