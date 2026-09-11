import { useStore } from '../../state/store';
import { makeCanvas } from '../layers';
import { getPersistenceUsage, savePage, saveProjectMeta, type SavedLayer } from '../persistence/db';
import { PROJECT_VERSION } from '../persistence/version';
import type { PaintEngine } from '../PaintEngine';

function toBlobP(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}

/** Debounced project persistence and storage usage refresh. */
export class AutosaveService {
  saveTimer: ReturnType<typeof setTimeout> | null = null;
  initialized = false;
  saveRevision = 0;
  persistedRevision = 0;
  saving: Promise<void> | null = null;
  storageTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private engine: PaintEngine) {}

  attachLifecycle(): void {
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  scheduleSave(): void {
    if (!this.initialized) return;
    this.saveRevision++;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flushSave();
    }, 200);
  }

  flushSave(): Promise<void> {
    const eng = this.engine;
    if (!this.initialized) return Promise.resolve();
    if (eng.isBusy()) return this.saving ?? Promise.resolve();
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (eng.hasOpenSession()) return Promise.resolve();
    if (this.saving) return this.saving;
    let failed = false;
    this.saving = (async () => {
      while (this.persistedRevision < this.saveRevision) {
        const targetRevision = this.saveRevision;
        try {
          await this.saveSnapshot();
          this.persistedRevision = targetRevision;
        } catch {
          failed = true;
          break;
        }
      }
    })().finally(() => {
      this.saving = null;
      if (!failed && this.persistedRevision < this.saveRevision) {
        queueMicrotask(() => void this.flushSave());
      }
    });
    return this.saving;
  }

  async saveSnapshot(): Promise<void> {
    const eng = this.engine;
    const ls = eng.layerService;
    const pages = eng.pages;
    const st = useStore.getState();
    const layerSources = ls.layers.map((l) => {
      if (l.type === 'text') return { ...ls.snapshotLayer(l, false), type: 'text' as const };
      if (l.type === 'adjust') {
        return {
          id: l.id,
          type: l.type,
          name: l.name,
          opacity: l.opacity,
          blend: l.blend,
          visible: l.visible,
          params: { ...l.params },
          maskLayerIds: [...l.maskLayerIds],
          parentId: l.parentId,
          childIds: [...l.childIds],
        };
      }
      if (l.type === 'shape') {
        return {
          id: l.id,
          type: l.type,
          name: l.name,
          opacity: l.opacity,
          blend: l.blend,
          visible: l.visible,
          parentId: l.parentId,
          childIds: [...l.childIds],
          shape: { ...l.shape },
        };
      }
      const canvas = makeCanvas(eng.artboard.w, eng.artboard.h);
      canvas.getContext('2d')!.drawImage(l.canvas, 0, 0);
      return {
        id: l.id,
        type: l.type,
        name: l.name,
        opacity: l.opacity,
        blend: l.blend,
        visible: l.visible,
        parentId: l.parentId,
        childIds: [...l.childIds],
        canvas,
      };
    });
    const activeLayerId = ls.activeLayerId;
    const view = eng.view.snapshot();
    const canvasSpec = { ...eng.getCanvasSpec() };
    const fonts = structuredClone(st.fonts);
    const rootLayerIds = [...ls.rootLayerIds];
    const penColor = st.penColor;
    const penSize = st.penSize;
    const colorHistory = [...st.colorHistory];
    const tools = st.tools.map((tool) => ({
      ...tool,
      penSettings: tool.penSettings ? { ...tool.penSettings } : undefined,
    }));
    const activeToolId = st.activeToolId;
    const toolLayout = structuredClone(st.toolLayout);
    const toolStacks = structuredClone(st.toolStacks);
    const historyPromise = eng.history.serialize(toBlobP);
    const layers: SavedLayer[] = await Promise.all(
      layerSources.map(async (l) => {
        if (l.type !== 'raster') return l;
        const { canvas, ...meta } = l;
        return { ...meta, blob: await toBlobP(canvas) };
      }),
    );
    let thumbnail: Blob | undefined;
    if (eng.compositor.main) {
      eng.ensureComposited();
      const thumb = document.createElement('canvas');
      thumb.width = 240;
      thumb.height = Math.max(1, Math.round(240 * eng.artboard.h / eng.artboard.w));
      thumb.getContext('2d')!.drawImage(eng.compositor.main, 0, 0, thumb.width, thumb.height);
      thumbnail = await new Promise(resolve => thumb.toBlob(blob => resolve(blob ?? undefined), 'image/webp', .72));
      pages.thumbnailVersion++;
    }
    await saveProjectMeta({
      version: PROJECT_VERSION,
      pageOrder: [...pages.pageOrder],
      activePageId: pages.activePageId,
      fonts,
      penColor,
      penSize,
      colorHistory,
      tools,
      toolLayout,
      toolStacks,
      activeToolId,
    });
    await savePage({
      id: pages.activePageId,
      canvasSpec,
      rootLayerIds,
      layers,
      activeLayerId,
      history: await historyPromise,
      view,
      thumbnailVersion: pages.thumbnailVersion,
      thumbnail,
    });
    this.scheduleStorageRefresh();
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.engine.events.emit('textCommitRequest');
      void this.flushSave();
    }
  };

  private onPageHide = (event: PageTransitionEvent): void => {
    this.engine.events.emit('textCommitRequest');
    if (event.persisted) {
      void this.flushSave();
      return;
    }
    this.engine.layerService.finishFloating();
    this.scheduleSave();
    void this.flushSave();
  };

  scheduleStorageRefresh(): void {
    if (this.storageTimer !== null) clearTimeout(this.storageTimer);
    this.storageTimer = setTimeout(() => {
      this.storageTimer = null;
      void this.refreshStorageUsage();
    }, 120);
  }

  private async refreshStorageUsage(): Promise<void> {
    try {
      const persisted = await getPersistenceUsage();
      const history = this.engine.history.retainedBytes();
      useStore.getState().set({
        storageUsage: {
          history,
          project: persisted.project,
          timelapse: persisted.timelapse,
          other: persisted.other,
          total: history + persisted.project + persisted.timelapse + persisted.other,
        },
      });
    } catch {
      // 容量取得の失敗は描画・保存を妨げない。
    }
  }
}
