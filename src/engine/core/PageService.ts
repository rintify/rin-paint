import { runtimeCheckpoint } from './RuntimeCheckpoint';
import { useStore } from '../../state/store';
import { HistoryTree } from '../history/historyTree';
import { canvasToBlob, createRasterLayer } from '../layers';
import {
  deletePageData,
  collectUnusedRasterAssets,
  loadPage,
  savePage,
  saveProjectMeta,
  setPersistencePageId,
  type SavedPage,
} from '../persistence/db';
import { PROJECT_VERSION } from '../persistence/version';
import type { PaintEngine } from '../PaintEngine';

/** Page order, active page, and page CRUD. */
export class PageService {
  pageOrder: string[] = [];
  activePageId = '';
  thumbnailVersion = 0;

  constructor(private engine: PaintEngine) {}

  newPageId(): string {
    return `P${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  }

  async saveMeta(): Promise<void> {
    if (this.engine.document.mode !== 'edit') return;
    const st = useStore.getState();
    await saveProjectMeta({
      version: PROJECT_VERSION,
      pageOrder: [...this.pageOrder],
      activePageId: this.activePageId,
      fonts: structuredClone(st.fonts),
    });
  }

  async addPage(): Promise<void> {
    const eng = this.engine;
    if (!eng.canMutate()) return;
    await eng.flushSavePublic();
    const id = this.newPageId();
    const layer = createRasterLayer(
      'レイヤー 1',
      eng.artboard.w,
      eng.artboard.h,
    );
    const history = new HistoryTree();
    const page: SavedPage = {
      id,
      pageSpec: { ...eng.getPageSpec() },
      rootLayerIds: [layer.id],
      activeLayerId: layer.id,
      layers: [eng.layerService.snapshotLayer(layer, true)],
      history: await history.serialize(canvasToBlob),
      view: { x: 0, y: 0, scale: 1, rot: 0 },
      thumbnailVersion: 0,
    };
    const index = Math.max(0, this.pageOrder.indexOf(this.activePageId));
    this.pageOrder.splice(index + 1, 0, id);
    await savePage(page);
    eng.links.noteSavedPage(page);
    await this.saveMeta();
    eng.syncStore();
  }

  async switchPage(id: string): Promise<void> {
    const eng = this.engine;
    if (useStore.getState().fillProgress !== null) eng.cancelFill();
    if (
      eng.isBusy() ||
      id === this.activePageId ||
      !this.pageOrder.includes(id)
    )
      return;
    // Lock before the first await so repeated page clicks cannot race the save.
    let rollback: (() => void) | undefined;
    const previousId = this.activePageId;
    const previousHistory = eng.history;
    const previousThumbnailVersion = this.thumbnailVersion;
    try {
      eng.layerService.finishFloating();
      eng.cancelSessions();
      eng.activeTool().cancel?.();
      eng.cursor.cancel();
      eng.input.resetPageInteraction();
      eng.shapeEdit.resetPageInteraction();
      // exitMultiSelect notifies the move tool and creates a float on the OLD page.
      useStore.getState().set({ multiSelectMode: false, selectedLayerIds: [], toolNotice: null });
      eng.syncStore();
      const preview = eng.document.getPage(id);
      useStore.getState().set({
        pageBusy: true,
        loadingPage: { id, spec: { ...(preview?.spec ?? eng.getPageSpec()) }, thumbnail: preview?.thumbnail },
      });
      eng.setBusy(true);
      // Give React and the browser a paint opportunity before expensive decoding.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await eng.autosave.flushForPageSwitch();
      if (eng.autosave.failed) throw new Error('ページを保存できませんでした');
      await eng.links.flush();
      await eng.recorderPublic().reset();
      const page = await loadPage(id, false);
      if (!page) throw new Error('ページを読み込めませんでした');
      rollback = runtimeCheckpoint(eng);
      this.activePageId = id;
      setPersistencePageId(id);
      await eng.restoreSavedPagePublic(page, { preserveView: true });
      eng.links.reconcileAll();
      await this.saveMeta();
      eng.events.emit('projectReset');
      eng.shapeEdit.refreshVertexState();
      eng.syncStore();
      await eng.compositor.renderNextFrame();
      eng.scheduleSave();
    } catch (error) {
      this.activePageId = previousId;
      this.thumbnailVersion = previousThumbnailVersion;
      setPersistencePageId(previousId);
      eng.history = previousHistory;
      rollback?.();
      throw error;
    } finally {
      eng.setBusy(false);
      useStore.getState().set({ pageBusy: false, loadingPage: null });
    }
  }

  async deletePage(id: string): Promise<void> {
    if (!this.engine.canMutate()) return;
    if (this.pageOrder.length <= 1 || !this.pageOrder.includes(id)) return;
    const index = this.pageOrder.indexOf(id);
    if (id === this.activePageId) {
      const target = this.pageOrder[index + 1] ?? this.pageOrder[index - 1];
      await this.switchPage(target);
    }
    this.pageOrder = this.pageOrder.filter((pageId) => pageId !== id);
    this.engine.links.removePage(id);
    await deletePageData(id);
    await collectUnusedRasterAssets();
    await this.saveMeta();
    this.engine.syncStore();
  }

  async reorderPages(from: number, to: number): Promise<void> {
    if (!this.engine.canMutate()) return;
    if (
      from < 0 ||
      to < 0 ||
      from >= this.pageOrder.length ||
      to >= this.pageOrder.length ||
      from === to
    )
      return;
    const [id] = this.pageOrder.splice(from, 1);
    this.pageOrder.splice(to, 0, id);
    await this.saveMeta();
    this.engine.syncStore();
  }
}
