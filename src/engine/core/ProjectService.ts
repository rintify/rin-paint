import { useStore } from '../../state/store';
import {
  DEFAULT_PAGE,
  layerItem,
  type LayerType,
  type PageSpec,
  type ProjectFont,
} from '../../model';
import { HistoryTree, type PageSnapshot } from '../history/historyTree';
import { isPersistedHistory } from '../persistence/schema';
import { PROJECT_VERSION } from '../persistence/version';
import { restoreLayerFrom, savedLayerFrom, scaleLayer } from '../layer-types/registry';
import {
  canvasToBlob,
  createRasterLayer,
  type Layer,
} from '../layers';
import { validateLayerTree } from '../layerTree';
import {
  hasClipboard,
  loadPage,
  loadProjectMeta,
  loadBinItems,
  loadSharedLayerEntities,
  replaceProject,
  savePage,
  saveProjectMeta,
  setPersistencePageId,
  type SavedPage,
  type SavedProjectMeta,
} from '../persistence/db';
import {
  blobToDataURL,
  packProjectFile,
  unpackProjectFile,
} from '../persistence/projectFile';
import { downloadBlob } from '../timelapse/exporter';
import { loadFonts } from '../text/render';
import { pagePixels, validatePageSpec, pngWithPpi } from '../pageSpec';
import type { PaintEngine } from '../PaintEngine';
import { SparseRasterSurface } from '../raster/SparseRasterSurface';
import { hydrateLinkedRecords } from '../entities/linkedRecords';

/** Project lifecycle: init, import/export, resize, fonts. */
export class ProjectService {
  pageSpec: PageSpec = { ...DEFAULT_PAGE };
  projectGeneration = 0;

  constructor(private engine: PaintEngine) {}

  async restoreSavedPage(page: SavedPage): Promise<void> {
    const eng = this.engine;
    const ls = eng.layerService;
    ls.layers = [];
    ls.rootLayerIds = [...page.rootLayerIds];
    ls.rootHierarchy = structuredClone(page.hierarchy);
    this.pageSpec = { ...page.pageSpec };
    const pixels = pagePixels(this.pageSpec);
    eng.pageFrame.resize(pixels.width, pixels.height);
    eng.pageFrame.setOrigin(0, 0);
    eng.compositor.syncWorkCanvases();
    const hydrated = hydrateLinkedRecords(page.layers, await loadBinItems());
    for (const sl of hydrated) {
      const layer = await restoreLayerFrom(sl, { pageFrame: eng.pageFrame, ppi: this.pageSpec.ppi });
      if (layer) ls.layers.push(layer);
    }
    ls.rebuildScopePlacements();
    if (!validateLayerTree(ls.rootLayerIds, ls.layers)) throw new Error('invalid layer tree');
    ls.activeLayerId = page.activeLayerId;
    eng.history = new HistoryTree();
    if (isPersistedHistory(page.history)) eng.history.restore(page.history);
    eng.view.restore(page.view);
    eng.pages.thumbnailVersion = page.thumbnailVersion;
    ls.resetCountersFromLayers();
    ls.clearVersions();
    eng.compositor.textRenderer.clear();
    ls.fixActive();
    eng.compositor.syncTextRenders();
    eng.links.noteSavedPage(page);
  }

  async doInit(): Promise<void> {
    const eng = this.engine;
    const ls = eng.layerService;
    const pages = eng.pages;
    let persistedDataFound = false;
    let restoreFailed = false;
    try {
      const meta = await loadProjectMeta();
      persistedDataFound = !!meta;
      if (meta?.version === PROJECT_VERSION && meta.pageOrder.length) {
        const restoredPages = await Promise.all(meta.pageOrder.map(loadPage));
        if (restoredPages.some(page => !page)) throw new Error('一部のページを読み込めませんでした');
        const page = restoredPages.find(value => value?.id === meta.activePageId);
        if (page && page.layers.length > 0 && !validatePageSpec(page.pageSpec)) {
          pages.pageOrder = [...meta.pageOrder];
          pages.activePageId = meta.activePageId;
          setPersistencePageId(pages.activePageId);
          await loadFonts(meta.fonts);
          useStore.getState().set({
            fonts: meta.fonts,
          });
          await this.restoreSavedPage(page);
          await Promise.all([
            saveProjectMeta(meta),
            ...(restoredPages as SavedPage[]).map(saved => savePage(saved)),
          ]);
          useStore.getState().set({ pageW: eng.pageFrame.w, pageH: eng.pageFrame.h, pageSpec: { ...this.pageSpec } });
        }
      }
    } catch {
      restoreFailed = true;
      ls.layers = [];
    }
    if (persistedDataFound && ls.layers.length === 0) restoreFailed = true;
    if (ls.layers.length === 0) {
      const l = createRasterLayer('レイヤー 1', eng.pageFrame.w, eng.pageFrame.h, undefined, false, this.pageSpec.ppi);
      ls.layers.push(l);
      ls.rootLayerIds = [l.id];
      ls.rootHierarchy = [layerItem(l.id)];
      ls.activeLayerId = l.id;
      ls.resetCountersFromLayers();
      pages.activePageId = pages.newPageId();
      pages.pageOrder = [pages.activePageId];
      setPersistencePageId(pages.activePageId);
    }
    ls.fixActive();
    eng.setLastViewState(eng.view.snapshot());
    eng.autosave.initialized = !restoreFailed;
    useStore.getState().set({
      pages: pages.pageOrder.map(id => ({ id, thumbnailVersion: id === pages.activePageId ? pages.thumbnailVersion : 0 })),
      activePageId: pages.activePageId,
      editingDocument: { kind: 'page', id: pages.activePageId },
      clipboardAvailable: await hasClipboard().catch(() => false),
    });
    eng.compositor.syncTextRenders();
    eng.scheduleStorageRefresh();
    if (restoreFailed) {
      useStore.getState().set({ toolNotice: '保存データを復元できなかったため、自動保存を停止しました。新規作成または読込を選んでください。' });
    } else {
      eng.scheduleSave();
    }
  }

  pageSnapshot(): PageSnapshot {
    const eng = this.engine;
    const ls = eng.layerService;
    return {
      spec: { ...this.pageSpec },
      layers: ls.layers.map(l => ls.snapshotLayer(l, true, true)),
      roots: [...ls.rootLayerIds],
      hierarchy: structuredClone(ls.rootHierarchy),
      activeId: ls.activeLayerId,
    };
  }

  async restorePageSnapshot(snapshot: PageSnapshot): Promise<void> {
    const eng = this.engine;
    const ls = eng.layerService;
    this.pageSpec = { ...snapshot.spec };
    const pixels = pagePixels(snapshot.spec);
    eng.pageFrame.resize(pixels.width, pixels.height);
    eng.pageFrame.setOrigin(0, 0);
    ls.layers = [];
    for (const layer of snapshot.layers) await ls.restoreLayer(layer);
    ls.rootLayerIds = [...snapshot.roots];
    ls.rootHierarchy = structuredClone(snapshot.hierarchy);
    ls.rebuildScopePlacements();
    ls.activeLayerId = snapshot.activeId;
    eng.compositor.syncWorkCanvases();
    eng.compositor.textRenderer.clear();
    eng.compositor.syncTextRenders();
    useStore.getState().set({ pageW: eng.pageFrame.w, pageH: eng.pageFrame.h, pageSpec: { ...this.pageSpec } });
  }

  async resizePage(spec: PageSpec): Promise<void> {
    const eng = this.engine;
    const ls = eng.layerService;
    if (eng.isBusy()) throw new Error('処理の完了後にサイズを変更してください');
    if (eng.bins.activeBinId) throw new Error('ビン編集中はページサイズを変更できません');
    const error = validatePageSpec(spec);
    if (error) throw new Error(error);
    if (JSON.stringify(spec) === JSON.stringify(this.pageSpec)) return;
    ls.finishFloating();
    eng.cancelSessions();
    eng.setBusy(true);
    const before = this.pageSnapshot();
    try {
      const { width, height } = pagePixels(spec);
      const factor = spec.ppi / this.pageSpec.ppi;
      for (const layer of ls.layers) {
        if (layer.dataLink) continue;
        scaleLayer(layer, factor, { width, height });
        ls.bumpLayer(layer.id);
      }
      this.pageSpec = { ...spec };
      eng.pageFrame.resize(width, height);
      eng.pageFrame.setOrigin(0, 0);
      eng.compositor.syncWorkCanvases();
      const after = this.pageSnapshot();
      const node = eng.history.push({ kind: 'pageChange', before, after }, 'ページサイズ・解像度');
      const encodeSnapshots = async (snapshots: typeof before.layers, ppi: number) => Promise.all(snapshots.map(async snapshot => {
        if (snapshot.canvas) {
          try {
            if (snapshot.type === 'raster') {
              const sparse = new SparseRasterSurface(ppi);
              sparse.drawInRect({ x: 0, y: 0, w: snapshot.canvas.width, h: snapshot.canvas.height }, ctx => ctx.drawImage(snapshot.canvas!, 0, 0));
              snapshot.content = await sparse.toBlob();
            } else snapshot.content = await canvasToBlob(snapshot.canvas);
            snapshot.canvas = undefined;
          }
          catch { /* Keep the original canvas so undo remains lossless; persistence can retry. */ }
        }
      }));
      node.ready = Promise.all([
        encodeSnapshots(before.layers, before.spec.ppi),
        encodeSnapshots(after.layers, after.spec.ppi),
      ]).then(() => undefined);
      useStore.getState().set({ pageW: width, pageH: height, pageSpec: { ...spec } });
      eng.compositor.textRenderer.clear();
    } catch (error) {
      await this.restorePageSnapshot(before);
      throw error;
    } finally { eng.setBusy(false); }
    eng.committed();
  }

  async newProject(): Promise<void> {
    const eng = this.engine;
    const ls = eng.layerService;
    const pages = eng.pages;
    if (eng.isBusy()) throw new Error('処理の完了後に新規作成してください');
    eng.finishTextEditing();
    eng.cancelSessions();
    eng.input.clearPendingPress();
    eng.activeTool().cancel?.();
    eng.cancelShapeEdit();
    eng.input.activePointer = null;
    eng.setBusy(true);
    this.projectGeneration++;
    try {
      await eng.recorderPublic().reset();
      if (eng.autosave.saveTimer !== null) { clearTimeout(eng.autosave.saveTimer); eng.autosave.saveTimer = null; }
      await eng.autosave.saving;
      const layer = createRasterLayer('レイヤー 1', eng.pageFrame.w, eng.pageFrame.h, undefined, false, this.pageSpec.ppi);
      const history = new HistoryTree();
      const pageId = pages.newPageId();
      const meta: SavedProjectMeta = {
        version: PROJECT_VERSION,
        pageOrder: [pageId],
        activePageId: pageId,
        fonts: [],
        binOrder: [],
        lastPagePpi: this.pageSpec.ppi,
      };
      const page: SavedPage = {
        id: pageId,
        pageSpec: { ...this.pageSpec },
        rootLayerIds: [layer.id],
        hierarchy: [layerItem(layer.id)],
        activeLayerId: layer.id,
        layers: [await savedLayerFrom(layer, { pageFrame: eng.pageFrame, ppi: this.pageSpec.ppi })],
        history: await history.serialize(canvasToBlob),
        view: { x: 0, y: 0, scale: 1, rot: 0 },
        thumbnailVersion: 0,
      };
      await replaceProject(meta, [page]);
      eng.bins.reset();
      pages.activePageId = pageId; pages.pageOrder = [pageId]; pages.thumbnailVersion = 0;
      await eng.links.refreshCatalog();
      setPersistencePageId(pageId);
      ls.layers = [layer]; ls.rootLayerIds = [layer.id]; ls.rootHierarchy = [layerItem(layer.id)]; ls.activeLayerId = layer.id;
      ls.resetCountersFromLayers(); eng.history = history; ls.clearVersions();
      eng.compositor.textRenderer.clear();
      await loadFonts([]);
      eng.autosave.persistedRevision = eng.autosave.saveRevision;
      useStore.getState().set({ fonts: [], textEditingId: null, projectGeneration: this.projectGeneration, selectionActive: false, freeTransform: false, selectedLayerIds: [layer.id], multiSelectMode: false, clipboardAvailable: false, pages: [{ id: pageId, thumbnailVersion: 0 }], activePageId: pageId, editingDocument: { kind: 'page', id: pageId }, binItems: [] });
      eng.events.emit('projectReset');
      eng.view.reset();
      eng.shapeEdit.refreshVertexState();
      eng.requestRender(); eng.syncStore(); eng.scheduleStorageRefresh();
    } finally { eng.setBusy(false); }
  }

  async addFont(file: File): Promise<ProjectFont | null> {
    const eng = this.engine;
    if (eng.isBusy()) return null;
    const generation = this.projectGeneration;
    if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error('TTF・OTF・WOFF・WOFF2を選択してください');
    const dataUrl = await blobToDataURL(file);
    const font = { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, ''), dataUrl };
    const probe = new FontFace(`rin-font-${font.id}`, `url("${dataUrl}")`);
    await probe.load();
    if (generation !== this.projectGeneration) return null;
    const existing = useStore.getState().fonts.find(f => f.dataUrl === dataUrl);
    if (existing) return existing;
    const fonts = [...useStore.getState().fonts, font];
    useStore.getState().set({ fonts });
    await loadFonts(fonts);
    if (generation !== this.projectGeneration) return null;
    eng.compositor.textRenderer.clear();
    eng.committed();
    return font;
  }

  async exportPNG(): Promise<void> {
    const eng = this.engine;
    if (!eng.compositor.main) return;
    eng.finishTextEditing();
    await eng.readyToRender();
    downloadBlob(await pngWithPpi(await canvasToBlob(eng.compositor.main), this.pageSpec.ppi), 'rin-paint.png');
  }

  async exportProject(): Promise<void> {
    const eng = this.engine;
    if (eng.isBusy()) throw new Error('処理の完了後に保存してください');
    eng.layerService.finishFloating();
    await eng.links.flush();
    eng.scheduleSave(); await eng.flushSavePublic();
    const meta = await loadProjectMeta();
    if (!meta) throw new Error('プロジェクトを保存できませんでした');
    const pages = (await Promise.all(meta.pageOrder.map(loadPage))).filter((page): page is SavedPage => !!page);
    if (pages.length !== meta.pageOrder.length) throw new Error('一部のページを読み込めませんでした');
    const [bins, entities] = await Promise.all([loadBinItems(), loadSharedLayerEntities()]);
    downloadBlob(await packProjectFile({ app: 'rin-paint', version: PROJECT_VERSION, meta, pages, bins, entities }), `rin-paint-${new Date().toISOString().slice(0, 10)}.rinpaint`);
  }

  async importProject(file: File): Promise<void> {
    const eng = this.engine;
    const ls = eng.layerService;
    const pages = eng.pages;
    if (eng.isBusy()) throw new Error('busy');
    const archive = await unpackProjectFile(file);
    const proj = archive.pages.find(page => page.id === archive.meta.activePageId) ?? archive.pages[0];
    if (eng.isBusy()) throw new Error('busy');
    ls.finishFloating();
    eng.cancelSessions();
    const before = this.pageSnapshot();
    const previousFonts = useStore.getState().fonts;
    const previousHistory = eng.history;
    eng.setBusy(true);
    this.projectGeneration++;
    try {
      await eng.recorderPublic().reset();
      if (eng.autosave.saveTimer !== null) { clearTimeout(eng.autosave.saveTimer); eng.autosave.saveTimer = null; }
      await eng.autosave.saving;
      const meta: SavedProjectMeta = {
        ...archive.meta,
        activePageId: proj.id,
        pageOrder: archive.pages.map(page => page.id),
      };
      await replaceProject(meta, archive.pages, archive.bins, archive.entities);
      await eng.bins.init();
      pages.pageOrder = [...meta.pageOrder]; pages.activePageId = meta.activePageId; setPersistencePageId(pages.activePageId);
      await eng.links.refreshCatalog();
      this.pageSpec = { ...proj.pageSpec };
      const pixels = pagePixels(this.pageSpec);
      eng.pageFrame.resize(pixels.width, pixels.height);
      await loadFonts(archive.meta.fonts);
      useStore.getState().set({ fonts: archive.meta.fonts });
      eng.compositor.textRenderer.clear();
      eng.compositor.syncWorkCanvases();
      const layers: Layer[] = [];
      const counters = new Map<LayerType, number>();
      const hydratedProjectLayers = hydrateLinkedRecords(proj.layers, archive.bins);
      for (const pl of hydratedProjectLayers) {
        const index = (counters.get(pl.type) ?? 0) + 1;
        counters.set(pl.type, index);
        const layer = await restoreLayerFrom(pl, { pageFrame: eng.pageFrame, ppi: this.pageSpec.ppi }, index);
        if (layer) layers.push(layer);
      }
      if (!layers.some((l) => l.type === 'raster')) {
        const fallback = createRasterLayer('レイヤー 1', eng.pageFrame.w, eng.pageFrame.h, undefined, false, this.pageSpec.ppi);
        layers.push(fallback);
        proj.rootLayerIds.push(fallback.id);
      }
      if (!validateLayerTree(proj.rootLayerIds, layers)) throw new Error('invalid layer tree');
      ls.layers = layers;
      ls.rootLayerIds = [...proj.rootLayerIds];
      ls.rootHierarchy = structuredClone(proj.hierarchy);
      ls.rebuildScopePlacements();
      ls.activeLayerId = proj.activeLayerId ?? '';
      ls.resetCountersFromLayers();
      eng.history = new HistoryTree();
      if (isPersistedHistory(proj.history)) eng.history.restore(proj.history);
      for (const l of layers) ls.bumpLayer(l.id);
      useStore.getState().set({
        pageW: eng.pageFrame.w,
        pageH: eng.pageFrame.h,
        pageSpec: { ...this.pageSpec },
        clipboardAvailable: false,
        activePageId: pages.activePageId,
        pages: pages.pageOrder.map(id => ({ id, thumbnailVersion: archive.pages.find(page => page.id === id)?.thumbnailVersion ?? 0 })),
      });
      ls.fixActive();
      eng.links.reconcileAll();
      eng.compositor.syncTextRenders();
    } catch (error) {
      await loadFonts(previousFonts);
      useStore.getState().set({ fonts: previousFonts });
      await this.restorePageSnapshot(before);
      eng.history = previousHistory;
      eng.syncStore();
      throw error;
    } finally {
      eng.setBusy(false);
    }
    eng.requestRender();
    eng.syncStore();
    eng.scheduleSave();
  }
}
