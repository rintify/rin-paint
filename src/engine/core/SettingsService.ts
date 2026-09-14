import { useStore } from '../../state/store';
import { isToolKind } from '../../tools/registry';
import { downloadBlob } from '../timelapse/exporter';
import { loadAppSettings, saveAppSettings, type SavedAppSettings } from '../persistence/db';
import { makeAppSettingsFile, parseAppSettingsFile, validateAppSettings } from '../persistence/settingsFile';
import type { PaintEngine } from '../PaintEngine';

/** App-wide tool and preference persistence, deliberately independent of projects. */
export class SettingsService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private initialized = false;

  constructor(private engine: PaintEngine) {
    useStore.subscribe((state, previous) => {
      if (
        state.penColor !== previous.penColor || state.penSizeMm !== previous.penSizeMm
        || state.colorHistory !== previous.colorHistory || state.tools !== previous.tools
        || state.toolLayout !== previous.toolLayout || state.toolStacks !== previous.toolStacks
        || state.activeToolId !== previous.activeToolId || state.timelapseEnabled !== previous.timelapseEnabled
        || state.showEffectRangeGuides !== previous.showEffectRangeGuides
        || state.shortcuts !== previous.shortcuts
      ) this.scheduleSave();
    });
    window.addEventListener('pagehide', () => void this.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush();
    });
  }

  snapshot(): SavedAppSettings {
    const state = useStore.getState();
    return {
      tools: structuredClone(state.tools),
      toolLayout: structuredClone(state.toolLayout),
      toolStacks: structuredClone(state.toolStacks),
      activeToolId: state.activeToolId,
      penColor: state.penColor,
      penSizeMm: state.penSizeMm,
      colorHistory: [...state.colorHistory],
      timelapseEnabled: state.timelapseEnabled,
      showEffectRangeGuides: state.showEffectRangeGuides,
      shortcuts: { ...state.shortcuts },
    };
  }

  async init(): Promise<void> {
    try {
      const saved = await loadAppSettings();
      if (saved) this.apply(saved);
    } catch {
      // Invalid app settings do not prevent the project from opening.
    }
    this.initialized = true;
    this.scheduleSave();
  }

  private apply(settings: SavedAppSettings): void {
    const current = useStore.getState();
    const active = settings.activeToolId
      ? settings.tools.find(tool => tool.id === settings.activeToolId)
      : undefined;
    current.set({
      tools: structuredClone(settings.tools),
      toolLayout: structuredClone(settings.toolLayout),
      toolStacks: structuredClone(settings.toolStacks),
      activeToolId: settings.activeToolId,
      tool: active && isToolKind(active.kind) ? active.kind : null,
      penColor: active?.color ?? settings.penColor,
      penSizeMm: active?.sizeMm ?? settings.penSizeMm,
      colorHistory: [...settings.colorHistory],
      timelapseEnabled: settings.timelapseEnabled,
      showEffectRangeGuides: settings.showEffectRangeGuides,
      shortcuts: { ...settings.shortcuts },
    });
    this.engine.recorderPublic().setEnabled(settings.timelapseEnabled);
    this.engine.syncActiveToolToLayer();
  }

  scheduleSave(): void {
    if (!this.initialized) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 200);
  }

  flush(): Promise<void> {
    if (!this.initialized) return Promise.resolve();
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    if (this.saving) return this.saving;
    this.saving = saveAppSettings(this.snapshot()).finally(() => { this.saving = null; });
    return this.saving;
  }

  async exportFile(): Promise<void> {
    const file = makeAppSettingsFile(validateAppSettings(this.snapshot()));
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `rin-paint-settings-${new Date().toISOString().slice(0, 10)}.rinsettings`);
  }

  async importFile(file: File): Promise<void> {
    const settings = parseAppSettingsFile(JSON.parse(await file.text()) as unknown);
    if (this.engine.isBusy()) throw new Error('処理の完了後に設定を読み込んでください');
    const before = this.snapshot();
    this.engine.layerService.finishFloating();
    this.engine.activeTool().cancel?.();
    this.apply(settings);
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    try {
      await saveAppSettings(this.snapshot());
    } catch (error) {
      this.apply(before);
      if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
      throw error;
    }
    this.engine.requestRender();
    this.engine.syncStore();
  }
}
