import { useStore } from '../../state/store';
import { isToolKind } from '../../tools/registry';
import { downloadBlob } from '../timelapse/exporter';
import { loadAppSettingsDetailed, saveAppSettings, type SavedAppSettings } from '../persistence/db';
import {
  makeAppSettingsFile,
  parseAppSettingsFileDetailed,
  type LoadedAppSettings,
} from '../persistence/settingsFile';
import { settingsNamespaces } from '../settings/namespaces';
import { SaveScheduler } from '../persistence/SaveScheduler';
import type { PaintEngine } from '../PaintEngine';

/** App-wide tool and preference persistence, deliberately independent of projects. */
export class SettingsService {
  private initialized = false;
  private retained: LoadedAppSettings['retained'] = {};
  private namespaceExtras: LoadedAppSettings['namespaceExtras'] = {};
  private readonly scheduler: SaveScheduler;

  constructor(private engine: PaintEngine) {
    this.scheduler = new SaveScheduler(
      () => saveAppSettings(this.snapshot(), this.retained, this.namespaceExtras),
      200,
    );
    useStore.subscribe((state, previous) => {
      if (!this.settingsChanged(state, previous)) return;
      this.scheduleSave();
    });
    window.addEventListener('pagehide', () => void this.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush();
    });
  }

  snapshot(): SavedAppSettings {
    return this.snapshotOf(useStore.getState());
  }

  private asSettings(state: ReturnType<typeof useStore.getState>): SavedAppSettings {
    return state as unknown as SavedAppSettings;
  }

  private snapshotOf(state: ReturnType<typeof useStore.getState>): SavedAppSettings {
    const settings = {} as SavedAppSettings;
    for (const namespace of settingsNamespaces()) {
      Object.assign(settings, namespace.toFlat(namespace.fromFlat(this.asSettings(state))));
    }
    return {
      ...settings,
      tools: structuredClone(settings.tools),
      toolLayout: structuredClone(settings.toolLayout),
      toolStacks: structuredClone(settings.toolStacks),
      colorHistory: [...settings.colorHistory],
      shortcuts: { ...settings.shortcuts },
    };
  }

  private settingsChanged(
    state: ReturnType<typeof useStore.getState>,
    previous: ReturnType<typeof useStore.getState>,
  ): boolean {
    const current = this.asSettings(state);
    const last = this.asSettings(previous);
    return settingsNamespaces().some((namespace) => {
      const currentValue = namespace.fromFlat(current) as Record<string, unknown>;
      const lastValue = namespace.fromFlat(last) as Record<string, unknown>;
      const keys = Object.keys(currentValue);
      return keys.length !== Object.keys(lastValue).length
        || keys.some((key) => currentValue[key] !== lastValue[key]);
    });
  }

  async init(): Promise<void> {
    try {
      const saved = await loadAppSettingsDetailed();
      if (saved) this.applyLoaded(saved);
    } catch {
      // Invalid app settings do not prevent the project from opening.
    }
    this.initialized = true;
    this.scheduleSave();
  }

  private applyLoaded(loaded: LoadedAppSettings): void {
    this.retained = loaded.retained;
    this.namespaceExtras = loaded.namespaceExtras;
    this.apply(loaded.settings);
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
    this.scheduler.schedule();
  }

  flush(): Promise<void> {
    if (!this.initialized) return Promise.resolve();
    return this.scheduler.flush();
  }

  async exportFile(): Promise<void> {
    const file = makeAppSettingsFile(this.snapshot(), this.retained, this.namespaceExtras);
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `rin-paint-settings-${new Date().toISOString().slice(0, 10)}.rinsettings`);
  }

  async importFile(file: File): Promise<void> {
    const loaded = parseAppSettingsFileDetailed(JSON.parse(await file.text()) as unknown);
    if (this.engine.isBusy()) throw new Error('処理の完了後に設定を読み込んでください');
    const before = this.snapshot();
    const beforeRetained = this.retained;
    const beforeExtras = this.namespaceExtras;
    this.engine.layerService.finishFloating();
    this.engine.activeTool().cancel?.();
    this.applyLoaded(loaded);
    try {
      await saveAppSettings(this.snapshot(), this.retained, this.namespaceExtras);
    } catch (error) {
      this.retained = beforeRetained;
      this.namespaceExtras = beforeExtras;
      this.apply(before);
      throw error;
    }
    this.engine.requestRender();
    this.engine.syncStore();
  }
}
