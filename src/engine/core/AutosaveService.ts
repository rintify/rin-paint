import {
  setRasterRootsProvider,
  releaseUnusedCanvases,
} from '../raster/RasterAssetRepository';
import { collectHistoryAssetIds, collectLayerAssetIds } from '../persistence/assetRefs';
import { useStore } from '../../state/store';
import { savedLayerFrom } from '../layer-types/registry';
import { canvasToBlob } from '../layers';
import {
  getPersistenceUsage,
  savePage,
  type SavedLayer,
} from '../persistence/db';
import { PROJECT_VERSION } from '../persistence/version';
import { SaveScheduler } from '../persistence/SaveScheduler';
import type { PaintEngine } from '../PaintEngine';

/** Debounced project persistence and storage usage refresh. */
export class AutosaveService {
  initialized = false;
  private flushingPageSwitch = false;
  storageTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly scheduler: SaveScheduler;

  constructor(private engine: PaintEngine) {
    this.scheduler = new SaveScheduler(
      () => this.saveSnapshot(),
      200,
      {
        ready: () =>
          this.initialized
          && this.engine.document.mode === 'edit'
          && (!this.engine.isBusy() || this.flushingPageSwitch)
          && !this.engine.hasOpenSession(),
        onFailure: () => {
          useStore.getState().set({
            toolNotice:
              '自動保存に失敗しました。内容を保持しています。保存を再試行してください。',
            saveFailed: true,
          });
        },
      },
    );
    setRasterRootsProvider(() => {
      if (engine.isBusy() || engine.hasOpenSession() || engine.document.mode !== 'edit') return null;
      const ids = collectHistoryAssetIds(engine.history.root);
      for (const layer of engine.layerService.layers) collectLayerAssetIds(layer, ids);
      return ids;
    });
  }

  attachLifecycle(): void {
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  scheduleSave(): void {
    if (!this.initialized || this.engine.document.mode !== 'edit') return;
    useStore.getState().set({ saveFailed: false });
    this.scheduler.schedule();
  }

  flushSave(): Promise<void> {
    if (!this.initialized) return Promise.resolve();
    return this.scheduler.flush() ?? Promise.resolve();
  }

  async flushForPageSwitch(): Promise<void> {
    this.flushingPageSwitch = true;
    try {
      await this.flushSave();
    } finally {
      this.flushingPageSwitch = false;
    }
  }

  cancelPending(): void {
    this.scheduler.cancel();
  }

  markClean(): void {
    this.scheduler.markClean();
  }

  get inflight(): Promise<void> | null {
    return this.scheduler.inflight;
  }

  get failed(): boolean {
    return this.scheduler.failed;
  }

  async saveSnapshot(): Promise<void> {
    const eng = this.engine;
    const ls = eng.layerService;
    const pages = eng.pages;
    const st = useStore.getState();
    // レイヤー内容は同期でコピーされ、PNG 化だけが非同期に進む。
    const layerSources = ls.layers.map((l) =>
      savedLayerFrom(l, { artboard: eng.artboard }),
    );
    const pageId = pages.activePageId;
    const pageOrder = [...pages.pageOrder];
    const activeLayerId = ls.activeLayerId;
    const view = eng.view.snapshot();
    const pageSpec = { ...eng.getPageSpec() };
    const fonts = structuredClone(st.fonts);
    const rootLayerIds = [...ls.rootLayerIds];
    const historyPromise = eng.history.serialize(canvasToBlob);
    const layersPromise: Promise<SavedLayer[]> = Promise.all(layerSources);
    let thumbnail: Blob | undefined;
    if (eng.compositor.main) {
      eng.ensureComposited();
      const src = eng.compositeCanvas();
      if (src) {
        const thumb = document.createElement('canvas');
        thumb.width = 240;
        thumb.height = Math.max(
          1,
          Math.round((240 * eng.artboard.h) / eng.artboard.w),
        );
        thumb
          .getContext('2d')!
          .drawImage(src, 0, 0, thumb.width, thumb.height);
        thumbnail = await new Promise((resolve) =>
          thumb.toBlob((blob) => resolve(blob ?? undefined), 'image/webp', 0.72),
        );
        pages.thumbnailVersion++;
      }
    }
    const page = {
      id: pageId,
      pageSpec,
      rootLayerIds,
      layers: await layersPromise,
      activeLayerId,
      history: await historyPromise,
      view,
      thumbnailVersion: pages.thumbnailVersion,
      thumbnail,
    };
    await savePage(page, {
      version: PROJECT_VERSION,
      pageOrder,
      activePageId: pageId,
      fonts,
    });
    eng.links.noteSavedPage(page);
    if (!eng.hasOpenSession() && !eng.isBusy() && eng.document.mode === 'edit') {
      const ids = new Set<string>();
      for (const layer of ls.layers) collectLayerAssetIds(layer, ids);
      releaseUnusedCanvases(ids);
    }
    this.scheduleStorageRefresh();
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.engine.events.emit('textCommitRequest');
      void this.flushSave().catch(() => undefined);
    }
  };

  private onPageHide = (event: PageTransitionEvent): void => {
    this.engine.events.emit('textCommitRequest');
    if (event.persisted) {
      void this.flushSave().catch(() => undefined);
      return;
    }
    this.engine.layerService.finishFloating();
    this.scheduleSave();
    void this.flushSave().catch(() => undefined);
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
          total: persisted.project + persisted.timelapse + persisted.other,
        },
      });
    } catch {
      // 容量取得の失敗は描画・保存を妨げない。
    }
  }
}
