import { cloneRuntimeLayers, runtimeCheckpoint } from './RuntimeCheckpoint';
import { useStore } from '../../state/store';
import {
  DEFAULT_PAGE,
  type LayerType,
  type PageSpec,
  type ProjectFont,
} from '../../model';
import { HistoryTree, type PageSnapshot } from '../history/historyTree';
import { isPersistedHistory } from '../persistence/schema';
import { PROJECT_VERSION } from '../persistence/version';
import {
  restoreLayerFrom,
  savedLayerFrom,
  scaleLayerAsync,
} from '../layer-types/registry';
import { canvasToBlob, createRasterLayer, type Layer } from '../layers';
import { validateLayerTree } from '../layerTree';
import {
  hasClipboard,
  collectUnusedRasterAssets,
  loadPage,
  loadRasterAssets,
  loadProjectMeta,
  replaceProject,
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
    this.pageSpec = { ...page.pageSpec };
    const pixels = pagePixels(this.pageSpec);
    eng.artboard.resize(pixels.width, pixels.height);
    eng.compositor.syncWorkCanvases();
    await loadRasterAssets(page);
    for (const sl of page.layers) {
      const layer = await restoreLayerFrom(sl, { artboard: eng.artboard });
      if (layer) ls.layers.push(layer);
    }
    if (!validateLayerTree(ls.rootLayerIds, ls.layers))
      throw new Error('invalid layer tree');
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
        const restoredPages = await Promise.all(
          meta.pageOrder.map((id) => loadPage(id, false)),
        );
        if (restoredPages.some((page) => !page))
          throw new Error('一部のページを読み込めませんでした');
        const page = restoredPages.find(
          (value) => value?.id === meta.activePageId,
        );
        if (
          page &&
          page.layers.length > 0 &&
          !validatePageSpec(page.pageSpec)
        ) {
          pages.pageOrder = [...meta.pageOrder];
          pages.activePageId = meta.activePageId;
          setPersistencePageId(pages.activePageId);
          await loadFonts(meta.fonts);
          useStore.getState().set({
            fonts: meta.fonts,
          });
          await this.restoreSavedPage(page);
          eng.links.replaceCatalog(restoredPages as SavedPage[]);
          useStore.getState().set({
            pageW: eng.artboard.w,
            pageH: eng.artboard.h,
            pageSpec: { ...this.pageSpec },
          });
        }
      }
    } catch {
      restoreFailed = true;
      ls.layers = [];
    }
    if (persistedDataFound && ls.layers.length === 0) restoreFailed = true;
    if (ls.layers.length === 0) {
      const l = createRasterLayer('レイヤー 1', eng.artboard.w, eng.artboard.h);
      ls.layers.push(l);
      ls.rootLayerIds = [l.id];
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
      pages: pages.pageOrder.map((id) => ({
        id,
        thumbnailVersion:
          id === pages.activePageId ? pages.thumbnailVersion : 0,
      })),
      activePageId: pages.activePageId,
      clipboardAvailable: await hasClipboard().catch(() => false),
    });
    eng.compositor.syncTextRenders();
    eng.scheduleStorageRefresh();
    if (!restoreFailed) void collectUnusedRasterAssets().catch(() => undefined);
    if (restoreFailed) {
      useStore.getState().set({
        toolNotice:
          '保存データを復元できなかったため、自動保存を停止しました。新規作成または読込を選んでください。',
      });
    } else if (!persistedDataFound) {
      eng.scheduleSave();
    }
  }

  restoreRuntimePageSpec(spec: PageSpec): void {
    const changed = JSON.stringify(spec) !== JSON.stringify(this.pageSpec);
    this.pageSpec = { ...spec };
    if (changed) {
      const size = pagePixels(spec);
      this.engine.artboard.resize(size.width, size.height);
      this.engine.compositor.syncWorkCanvases();
    }
    useStore.getState().set({
      pageW: this.engine.artboard.w,
      pageH: this.engine.artboard.h,
      pageSpec: { ...spec },
    });
  }

  pageSnapshot(): PageSnapshot {
    const eng = this.engine;
    const ls = eng.layerService;
    return {
      spec: { ...this.pageSpec },
      layers: ls.layers.map((l) => ls.snapshotLayer(l, true, true)),
      roots: [...ls.rootLayerIds],
      activeId: ls.activeLayerId,
    };
  }

  async restorePageSnapshot(snapshot: PageSnapshot): Promise<void> {
    const eng = this.engine;
    const ls = eng.layerService;
    const layers = [];
    for (const record of snapshot.layers) {
      const layer = await restoreLayerFrom(record, { artboard: eng.artboard });
      if (!layer) throw new Error('履歴のレイヤーを復元できません');
      layers.push(layer);
    }
    if (!validateLayerTree(snapshot.roots, layers))
      throw new Error('履歴のレイヤー構造が不正です');
    ls.layers = layers;
    ls.rootLayerIds = [...snapshot.roots];
    ls.activeLayerId = snapshot.activeId;
    this.restoreRuntimePageSpec(snapshot.spec);
    ls.clearVersions();
    eng.compositor.textRenderer.clear();
    eng.compositor.syncTextRenders();
  }

  async resizePage(spec: PageSpec): Promise<void> {
    spec = { ...spec };
    const eng = this.engine;
    const ls = eng.layerService;
    if (eng.isBusy()) throw new Error('処理の完了後にサイズを変更してください');
    const error = validatePageSpec(spec);
    if (error) throw new Error(error);
    if (JSON.stringify(spec) === JSON.stringify(this.pageSpec)) return;
    eng.finishTextEditing();
    await eng.commitFloatSelection();
    if (eng.isBusy()) throw new Error('処理の完了後にサイズを変更してください');
    eng.cancelSessions();
    const rollback = runtimeCheckpoint(eng);
    eng.setBusy(true);
    try {
      const before = this.pageSnapshot();
      const { width, height } = pagePixels(spec);
      const factor = spec.ppi / this.pageSpec.ppi;
      // Stage resolution changes without replacing any live layer until all resampling succeeds.
      if (factor !== 1) {
        const layers = cloneRuntimeLayers(ls.layers);
        for (const layer of layers)
          await scaleLayerAsync(layer, factor, { width, height });
        ls.layers = layers;
      }
      this.restoreRuntimePageSpec(spec);
      ls.clearVersions();
      eng.compositor.textRenderer.clear();
      eng.compositor.syncTextRenders();
      const after =
        factor === 1 ? { ...before, spec: { ...spec } } : this.pageSnapshot();
      const node = eng.history.push(
        { kind: 'pageChange', before, after },
        'ページサイズ・解像度',
      );
      node.ready = Promise.all(
        [...new Set([...before.layers, ...after.layers])].map(
          async (snapshot) => {
            if (snapshot.canvas) {
              try {
                snapshot.content = await canvasToBlob(snapshot.canvas);
                snapshot.canvas = undefined;
              } catch {
                /* Retain pixels for lossless undo and a later save retry. */
              }
            }
          },
        ),
      ).then(() => undefined);
    } catch (error) {
      rollback();
      throw error;
    } finally {
      eng.setBusy(false);
    }
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
      if (eng.autosave.saveTimer !== null) {
        clearTimeout(eng.autosave.saveTimer);
        eng.autosave.saveTimer = null;
      }
      await eng.autosave.saving;
      const layer = createRasterLayer(
        'レイヤー 1',
        eng.artboard.w,
        eng.artboard.h,
      );
      const history = new HistoryTree();
      const pageId = pages.newPageId();
      const meta: SavedProjectMeta = {
        version: PROJECT_VERSION,
        pageOrder: [pageId],
        activePageId: pageId,
        fonts: [],
      };
      const page: SavedPage = {
        id: pageId,
        pageSpec: { ...this.pageSpec },
        rootLayerIds: [layer.id],
        activeLayerId: layer.id,
        layers: [await savedLayerFrom(layer, { artboard: eng.artboard })],
        history: await history.serialize(canvasToBlob),
        view: { x: 0, y: 0, scale: 1, rot: 0 },
        thumbnailVersion: 0,
      };
      await replaceProject(meta, [page]);
      pages.activePageId = pageId;
      pages.pageOrder = [pageId];
      pages.thumbnailVersion = 0;
      await eng.links.refreshCatalog();
      setPersistencePageId(pageId);
      ls.layers = [layer];
      ls.rootLayerIds = [layer.id];
      ls.activeLayerId = layer.id;
      ls.resetCountersFromLayers();
      eng.history = history;
      ls.clearVersions();
      eng.compositor.textRenderer.clear();
      await loadFonts([]);
      eng.autosave.persistedRevision = eng.autosave.saveRevision;
      useStore.getState().set({
        fonts: [],
        textEditingId: null,
        projectGeneration: this.projectGeneration,
        selectionActive: false,
        freeTransform: false,
        selectedLayerIds: [layer.id],
        multiSelectMode: false,
        clipboardAvailable: false,
        pages: [{ id: pageId, thumbnailVersion: 0 }],
        activePageId: pageId,
      });
      eng.events.emit('projectReset');
      eng.view.reset();
      eng.shapeEdit.refreshVertexState();
      eng.requestRender();
      eng.syncStore();
      eng.scheduleStorageRefresh();
    } finally {
      eng.setBusy(false);
    }
  }

  async addFont(file: File): Promise<ProjectFont | null> {
    const eng = this.engine;
    if (eng.isBusy()) return null;
    const generation = this.projectGeneration;
    if (!/\.(ttf|otf|woff2?)$/i.test(file.name))
      throw new Error('TTF・OTF・WOFF・WOFF2を選択してください');
    const dataUrl = await blobToDataURL(file);
    const font = {
      id: crypto.randomUUID(),
      name: file.name.replace(/\.[^.]+$/, ''),
      dataUrl,
    };
    const probe = new FontFace(`rin-font-${font.id}`, `url("${dataUrl}")`);
    await probe.load();
    if (generation !== this.projectGeneration) return null;
    const existing = useStore
      .getState()
      .fonts.find((f) => f.dataUrl === dataUrl);
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
    downloadBlob(
      await pngWithPpi(
        await canvasToBlob(eng.compositor.main),
        this.pageSpec.ppi,
      ),
      'rin-paint.png',
    );
  }

  async exportProject(): Promise<void> {
    const eng = this.engine;
    if (eng.isBusy()) throw new Error('処理の完了後に保存してください');
    eng.layerService.finishFloating();
    await eng.links.flush();
    eng.scheduleSave();
    await eng.flushSavePublic();
    const meta = await loadProjectMeta();
    if (!meta) throw new Error('プロジェクトを保存できませんでした');
    const pages = (
      await Promise.all(meta.pageOrder.map((id) => loadPage(id)))
    ).filter((page): page is SavedPage => !!page);
    if (pages.length !== meta.pageOrder.length)
      throw new Error('一部のページを読み込めませんでした');
    downloadBlob(
      await packProjectFile({
        app: 'rin-paint',
        version: PROJECT_VERSION,
        meta,
        pages,
      }),
      `rin-paint-${new Date().toISOString().slice(0, 10)}.rinpaint`,
    );
  }

  async importProject(file: File): Promise<void> {
    const eng = this.engine;
    const ls = eng.layerService;
    const pages = eng.pages;
    if (eng.isBusy()) throw new Error('busy');
    const archive = await unpackProjectFile(file);
    // Decode and validate every page before replacing any persisted data.
    for (const page of archive.pages) {
      if (!new HistoryTree().restore(page.history))
        throw new Error('履歴構造が不正です');
      if (validatePageSpec(page.pageSpec))
        throw new Error('ページサイズが不正です');
      const size = pagePixels(page.pageSpec),
        layers: Layer[] = [];
      for (const record of page.layers) {
        const layer = await restoreLayerFrom(record, {
          artboard: { w: size.width, h: size.height },
        });
        if (!layer) throw new Error('レイヤーを復元できません');
        layers.push(layer);
      }
      if (
        !validateLayerTree(page.rootLayerIds, layers) ||
        !layers.some((l) => l.id === page.activeLayerId)
      )
        throw new Error('レイヤー構造が不正です');
    }
    const proj =
      archive.pages.find((page) => page.id === archive.meta.activePageId) ??
      archive.pages[0];
    if (eng.isBusy()) throw new Error('busy');
    ls.finishFloating();
    eng.cancelSessions();
    const previousFonts = useStore.getState().fonts;
    const previousHistory = eng.history;
    const rollbackRuntime = runtimeCheckpoint(eng);
    const rollbackCatalog = eng.links.catalogCheckpoint();
    const previousPageOrder = [...pages.pageOrder],
      previousPageId = pages.activePageId;
    eng.setBusy(true);
    this.projectGeneration++;
    try {
      await eng.recorderPublic().reset();
      if (eng.autosave.saveTimer !== null) {
        clearTimeout(eng.autosave.saveTimer);
        eng.autosave.saveTimer = null;
      }
      await eng.autosave.saving;
      const meta: SavedProjectMeta = {
        ...archive.meta,
        activePageId: proj.id,
        pageOrder: archive.pages.map((page) => page.id),
      };

      this.pageSpec = { ...proj.pageSpec };
      const pixels = pagePixels(this.pageSpec);
      eng.artboard.resize(pixels.width, pixels.height);
      await loadFonts(archive.meta.fonts);
      useStore.getState().set({ fonts: archive.meta.fonts });
      eng.compositor.textRenderer.clear();
      eng.compositor.syncWorkCanvases();
      const layers: Layer[] = [];
      const counters = new Map<LayerType, number>();
      for (const pl of proj.layers) {
        const index = (counters.get(pl.type) ?? 0) + 1;
        counters.set(pl.type, index);
        const layer = await restoreLayerFrom(
          pl,
          { artboard: eng.artboard },
          index,
        );
        if (layer) layers.push(layer);
      }
      if (!layers.some((l) => l.type === 'raster')) {
        const fallback = createRasterLayer(
          'レイヤー 1',
          eng.artboard.w,
          eng.artboard.h,
        );
        layers.push(fallback);
        proj.rootLayerIds.push(fallback.id);
      }
      if (!validateLayerTree(proj.rootLayerIds, layers))
        throw new Error('invalid layer tree');
      pages.pageOrder = [...meta.pageOrder];
      pages.activePageId = meta.activePageId;
      setPersistencePageId(pages.activePageId);
      ls.layers = layers;
      ls.rootLayerIds = [...proj.rootLayerIds];
      ls.activeLayerId = proj.activeLayerId ?? '';
      ls.resetCountersFromLayers();
      eng.history = new HistoryTree();
      if (isPersistedHistory(proj.history)) eng.history.restore(proj.history);
      for (const l of layers) ls.bumpLayer(l.id);
      useStore.getState().set({
        pageW: eng.artboard.w,
        pageH: eng.artboard.h,
        pageSpec: { ...this.pageSpec },
        clipboardAvailable: false,
        activePageId: pages.activePageId,
        pages: pages.pageOrder.map((id) => ({
          id,
          thumbnailVersion:
            archive.pages.find((page) => page.id === id)?.thumbnailVersion ?? 0,
        })),
      });
      ls.fixActive();
      eng.links.replaceCatalog(archive.pages);
      eng.links.reconcileAll();
      eng.compositor.syncTextRenders();
      await replaceProject(meta, archive.pages);
    } catch (error) {
      pages.pageOrder = previousPageOrder;
      pages.activePageId = previousPageId;
      setPersistencePageId(previousPageId);
      rollbackRuntime();
      rollbackCatalog();
      useStore.getState().set({ fonts: previousFonts });
      await loadFonts(previousFonts).catch(() => undefined);
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
