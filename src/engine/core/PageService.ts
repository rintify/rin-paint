import { useStore } from '../../state/store';
import { HistoryTree } from '../history/historyTree';
import { createRasterLayer } from '../layers';
import {
  deletePageData,
  loadPage,
  savePage,
  saveProjectMeta,
  setPersistencePageId,
  type SavedPage,
} from '../persistence/db';
import { PROJECT_VERSION } from '../persistence/version';
import type { PaintEngine } from '../PaintEngine';

function toBlobP(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}

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
    await eng.flushSavePublic();
    const id = this.newPageId();
    const layer = createRasterLayer('レイヤー 1', eng.artboard.w, eng.artboard.h);
    const history = new HistoryTree();
    const page: SavedPage = {
      id,
      pageSpec: { ...eng.getPageSpec() },
      rootLayerIds: [layer.id],
      activeLayerId: layer.id,
      layers: [{ ...eng.layerService.snapshotLayer(layer, false), content: await toBlobP(layer.runtime.canvas) }],
      history: await history.serialize(toBlobP),
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
    if (eng.isBusy() || id === this.activePageId || !this.pageOrder.includes(id)) return;
    eng.layerService.finishFloating();
    eng.cancelSessions();
    eng.cancelShapeEdit();
    eng.layerService.exitMultiSelect();
    await eng.flushSavePublic();
    await eng.links.flush();
    await eng.recorderPublic().reset();
    eng.setBusy(true);
    useStore.getState().set({ pageBusy: true });
    try {
      const page = await loadPage(id);
      if (!page) throw new Error('ページを読み込めませんでした');
      this.activePageId = id;
      setPersistencePageId(id);
      await eng.restoreSavedPagePublic(page);
      eng.links.reconcileAll();
      await this.saveMeta();
      eng.events.emit('projectReset');
      eng.shapeEdit.refreshVertexState();
      eng.requestRender();
      eng.syncStore();
      eng.scheduleSave();
    } finally {
      eng.setBusy(false);
      useStore.getState().set({ pageBusy: false });
    }
  }

  async deletePage(id: string): Promise<void> {
    if (this.pageOrder.length <= 1 || !this.pageOrder.includes(id)) return;
    const index = this.pageOrder.indexOf(id);
    if (id === this.activePageId) {
      const target = this.pageOrder[index + 1] ?? this.pageOrder[index - 1];
      await this.switchPage(target);
    }
    this.pageOrder = this.pageOrder.filter(pageId => pageId !== id);
    this.engine.links.removePage(id);
    await deletePageData(id);
    await this.saveMeta();
    this.engine.syncStore();
  }

  async reorderPages(from: number, to: number): Promise<void> {
    if (from < 0 || to < 0 || from >= this.pageOrder.length || to >= this.pageOrder.length || from === to) return;
    const [id] = this.pageOrder.splice(from, 1);
    this.pageOrder.splice(to, 0, id);
    await this.saveMeta();
    this.engine.syncStore();
  }
}
