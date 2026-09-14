import { useStore } from '../../state/store';
import { getPersistenceUsage, saveProjectSnapshot, saveBin, type SavedLayer } from '../persistence/db';
import { PROJECT_VERSION } from '../persistence/version';
import type { PaintEngine } from '../PaintEngine';

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
    const capturedDocument = {...eng.documentKey};
    await eng.canvases.flush();
    if (capturedDocument.kind !== eng.documentKey.kind || capturedDocument.id !== eng.documentKey.id) return;
    const ls = eng.layerService;
    const pages = eng.pages;
    const st = useStore.getState();
    const binId = eng.bins.activeId;
    const pageId = pages.activePageId;
    const pageOrder = [...pages.pageOrder];
    // レイヤー内容は同期でコピーされ、PNG 化だけが非同期に進む。
    const layerSources = ls.layers.map((l) => eng.canvases.saveOccurrence(eng.links.resolveLayer(l)));
    const activeLayerId = ls.activeLayerId;
    const selection={selectedLayerIds:[...st.selectedLayerIds],multiSelectMode:st.multiSelectMode};
    const view = eng.view.snapshot();
    const pageSpec = { ...eng.getPageSpec() };
    const fonts = structuredClone(st.fonts);
    const rootLayerIds = [...ls.rootLayerIds];
    const layerStacks = eng.stacks.snapshot();
    const historyPromise = eng.history.serialize();
    const deletedSourcesPromise = eng.links.serializeDeletedSources();
    let thumbnailPromise: Promise<Blob | undefined> = Promise.resolve(undefined);
    let thumbnailVersion = pages.thumbnailVersion;
    if (eng.compositor.main) {
      eng.ensureComposited();
      const thumb = document.createElement('canvas');
      thumb.width = 240;
      thumb.height = Math.max(1, Math.round(240 * eng.artboard.h / eng.artboard.w));
      thumb.getContext('2d')!.drawImage(eng.compositor.main, 0, 0, thumb.width, thumb.height);
      thumbnailPromise = new Promise(resolve => thumb.toBlob(blob => resolve(blob ?? undefined), 'image/webp', .72));
      thumbnailVersion = ++pages.thumbnailVersion;
    }
    const layers: SavedLayer[] = await Promise.all(layerSources);
    const [history, thumbnail, deletedSources] = await Promise.all([historyPromise, thumbnailPromise, deletedSourcesPromise]);
    const page = {
      id: pageId,
      pageSpec,
      rootLayerIds,
      layerStacks,
      layers,
      activeLayerId,
      selection,
      history,
      view,
      thumbnailVersion,
      thumbnail,
    };
    const meta = {version: PROJECT_VERSION, pageOrder, activePageId: pageId, activeBinId: binId, fonts, deletedSources};
    if (binId) {
      const bin = {id: binId, rootLayerIds, layers, activeLayerId, selection, history, view, workArea: pageSpec};
      await saveBin(bin, meta); eng.bins.noteSaved(bin);
    } else {
      await saveProjectSnapshot(meta, page); eng.links.noteSavedPage(page);
    }
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
