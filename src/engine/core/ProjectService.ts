import { useStore } from '../../state/store';
import {
  DEFAULT_CANVAS,
  type LayerType,
  type ToolInstance,
  type CanvasSpec,
  type ProjectFont,
} from '../../model';
import { normalizeToolInstance } from '../../tools/registry';
import { HistoryTree, type CanvasSnapshot } from '../history/historyTree';
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
  loadTimelapseEnabled,
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
import { canvasPixels, validateCanvasSpec, pngWithPpi } from '../canvasSpec';
import type { PaintEngine } from '../PaintEngine';

/** Project lifecycle: init, import/export, resize, fonts. */
export class ProjectService {
  canvasSpec: CanvasSpec = { ...DEFAULT_CANVAS };
  projectGeneration = 0;

  constructor(private engine: PaintEngine) {}

  restoreTools(tools: unknown, activeToolId: unknown, toolLayout?: unknown, toolStacks?: unknown): void {
    if (!Array.isArray(tools)) return;
    const valid = tools
      .map((t) => normalizeToolInstance(t))
      .filter((t): t is ToolInstance => !!t);
    const st = useStore.getState();
    const validIds = new Set(valid.map(tool => tool.id));
    const stacks = Array.isArray(toolStacks) ? toolStacks.filter(stack => stack && typeof stack.id === 'string' && typeof stack.name === 'string' && Array.isArray(stack.toolIds)).map(stack => ({ ...stack, toolIds: stack.toolIds.filter((id: unknown): id is string => typeof id === 'string' && validIds.has(id)) })).filter(stack => stack.toolIds.length >= 2) : [];
    const stackIds = new Set(stacks.map(stack => stack.id));
    const layout = Array.isArray(toolLayout) ? toolLayout.filter(item => item && ((item.type === 'tool' && validIds.has(item.toolId)) || (item.type === 'stack' && stackIds.has(item.stackId)))) : valid.map(tool => ({ type: 'tool' as const, toolId: tool.id }));
    st.set({ tools: valid, toolLayout: layout, toolStacks: stacks });
    const active = valid.some((t) => t.id === activeToolId)
      ? (activeToolId as string)
      : null;
    if (active) st.activateTool(active); else st.deactivateTool();
  }

  async restoreSavedPage(page: SavedPage): Promise<void> {
    const eng = this.engine;
    const ls = eng.layerService;
    ls.layers = [];
    ls.rootLayerIds = [...page.rootLayerIds];
    this.canvasSpec = { ...page.canvasSpec };
    const pixels = canvasPixels(this.canvasSpec);
    eng.artboard.resize(pixels.width, pixels.height);
    eng.compositor.syncWorkCanvases();
    for (const sl of page.layers) {
      const layer = await restoreLayerFrom(sl, { artboard: eng.artboard });
      if (layer) ls.layers.push(layer);
    }
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
  }

  async doInit(): Promise<void> {
    const eng = this.engine;
    const ls = eng.layerService;
    const pages = eng.pages;
    try {
      useStore.getState().set({ timelapseEnabled: await loadTimelapseEnabled() });
    } catch {
      // 設定を読めない場合も、既定値のオンでプロジェクト復元を続ける。
    }
    let persistedDataFound = false;
    let restoreFailed = false;
    try {
      const meta = await loadProjectMeta();
      persistedDataFound = !!meta;
      if (meta?.version === PROJECT_VERSION && meta.pageOrder.length) {
        const restoredPages = await Promise.all(meta.pageOrder.map(loadPage));
        if (restoredPages.some(page => !page)) throw new Error('一部のページを読み込めませんでした');
        const page = restoredPages.find(value => value?.id === meta.activePageId);
        if (page && page.layers.length > 0 && !validateCanvasSpec(page.canvasSpec)) {
          pages.pageOrder = [...meta.pageOrder];
          pages.activePageId = meta.activePageId;
          setPersistencePageId(pages.activePageId);
          await loadFonts(meta.fonts);
          useStore.getState().set({
            fonts: meta.fonts,
            penColor: meta.penColor,
            penSize: meta.penSize,
            colorHistory: meta.colorHistory,
          });
          this.restoreTools(meta.tools, meta.activeToolId, meta.toolLayout, meta.toolStacks);
          await this.restoreSavedPage(page);
          await Promise.all([
            saveProjectMeta(meta),
            ...(restoredPages as SavedPage[]).map(saved => savePage(saved)),
          ]);
          useStore.getState().set({ canvasW: eng.artboard.w, canvasH: eng.artboard.h, canvasSpec: { ...this.canvasSpec } });
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
      pages: pages.pageOrder.map(id => ({ id, thumbnailVersion: id === pages.activePageId ? pages.thumbnailVersion : 0 })),
      activePageId: pages.activePageId,
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

  canvasSnapshot(): CanvasSnapshot {
    const eng = this.engine;
    const ls = eng.layerService;
    return {
      spec: { ...this.canvasSpec },
      layers: ls.layers.map(l => ls.snapshotLayer(l, true, true)),
      roots: [...ls.rootLayerIds],
      activeId: ls.activeLayerId,
    };
  }

  async restoreCanvasSnapshot(snapshot: CanvasSnapshot): Promise<void> {
    const eng = this.engine;
    const ls = eng.layerService;
    this.canvasSpec = { ...snapshot.spec };
    const pixels = canvasPixels(snapshot.spec);
    eng.artboard.resize(pixels.width, pixels.height);
    ls.layers = [];
    for (const layer of snapshot.layers) await ls.restoreLayer(layer);
    ls.rootLayerIds = [...snapshot.roots];
    ls.activeLayerId = snapshot.activeId;
    eng.compositor.syncWorkCanvases();
    eng.compositor.textRenderer.clear();
    eng.compositor.syncTextRenders();
    useStore.getState().set({ canvasW: eng.artboard.w, canvasH: eng.artboard.h, canvasSpec: { ...this.canvasSpec } });
  }

  async resizeCanvas(spec: CanvasSpec): Promise<void> {
    const eng = this.engine;
    const ls = eng.layerService;
    if (eng.isBusy()) throw new Error('処理の完了後にサイズを変更してください');
    const error = validateCanvasSpec(spec);
    if (error) throw new Error(error);
    if (JSON.stringify(spec) === JSON.stringify(this.canvasSpec)) return;
    ls.finishFloating();
    eng.cancelSessions();
    eng.setBusy(true);
    const before = this.canvasSnapshot();
    try {
      const { width, height } = canvasPixels(spec);
      const factor = spec.ppi / this.canvasSpec.ppi;
      for (const layer of ls.layers) {
        scaleLayer(layer, factor, { width, height });
        ls.bumpLayer(layer.id);
      }
      this.canvasSpec = { ...spec };
      eng.artboard.resize(width, height);
      eng.compositor.syncWorkCanvases();
      const after = this.canvasSnapshot();
      const node = eng.history.push({ kind: 'canvasChange', before, after }, 'キャンバスサイズ・解像度');
      node.ready = Promise.all([...before.layers, ...after.layers].map(async snapshot => {
        if (snapshot.canvas) {
          try { snapshot.blob = await canvasToBlob(snapshot.canvas); snapshot.canvas = undefined; }
          catch { /* Keep the original canvas so undo remains lossless; persistence can retry. */ }
        }
      })).then(() => undefined);
      useStore.getState().set({ canvasW: width, canvasH: height, canvasSpec: { ...spec } });
      eng.compositor.textRenderer.clear();
    } catch (error) {
      await this.restoreCanvasSnapshot(before);
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
      const layer = createRasterLayer('レイヤー 1', eng.artboard.w, eng.artboard.h);
      const st = useStore.getState();
      const history = new HistoryTree();
      const pageId = pages.newPageId();
      const meta: SavedProjectMeta = {
        version: PROJECT_VERSION,
        pageOrder: [pageId],
        activePageId: pageId,
        fonts: [],
        tools: structuredClone(st.tools),
        activeToolId: st.activeToolId,
        penColor: st.penColor,
        penSize: st.penSize,
        toolLayout: structuredClone(st.toolLayout),
        toolStacks: structuredClone(st.toolStacks),
        colorHistory: [...st.colorHistory],
      };
      const page: SavedPage = {
        id: pageId,
        canvasSpec: { ...this.canvasSpec },
        rootLayerIds: [layer.id],
        activeLayerId: layer.id,
        layers: [await savedLayerFrom(layer, { artboard: eng.artboard })],
        history: await history.serialize(canvasToBlob),
        view: { x: 0, y: 0, scale: 1, rot: 0 },
        thumbnailVersion: 0,
      };
      await replaceProject(meta, [page]);
      pages.activePageId = pageId; pages.pageOrder = [pageId]; pages.thumbnailVersion = 0;
      setPersistencePageId(pageId);
      ls.layers = [layer]; ls.rootLayerIds = [layer.id]; ls.activeLayerId = layer.id;
      ls.resetCountersFromLayers(); eng.history = history; ls.clearVersions();
      eng.compositor.textRenderer.clear();
      await loadFonts([]);
      eng.autosave.persistedRevision = eng.autosave.saveRevision;
      useStore.getState().set({ fonts: [], textEditingId: null, projectGeneration: this.projectGeneration, selectionActive: false, freeTransform: false, selectedLayerIds: [layer.id], multiSelectMode: false, clipboardAvailable: false, pages: [{ id: pageId, thumbnailVersion: 0 }], activePageId: pageId });
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
    downloadBlob(await pngWithPpi(await canvasToBlob(eng.compositor.main), this.canvasSpec.ppi), 'rin-paint.png');
  }

  async exportProject(): Promise<void> {
    const eng = this.engine;
    if (eng.isBusy()) throw new Error('処理の完了後に保存してください');
    eng.layerService.finishFloating();
    eng.scheduleSave(); await eng.flushSavePublic();
    const meta = await loadProjectMeta();
    if (!meta) throw new Error('プロジェクトを保存できませんでした');
    const pages = (await Promise.all(meta.pageOrder.map(loadPage))).filter((page): page is SavedPage => !!page);
    if (pages.length !== meta.pageOrder.length) throw new Error('一部のページを読み込めませんでした');
    downloadBlob(await packProjectFile({ app: 'rin-paint', version: PROJECT_VERSION, meta, pages }), `rin-paint-${new Date().toISOString().slice(0, 10)}.rinpaint`);
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
    const before = this.canvasSnapshot();
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
      await replaceProject(meta, archive.pages);
      pages.pageOrder = [...meta.pageOrder]; pages.activePageId = meta.activePageId; setPersistencePageId(pages.activePageId);
      this.canvasSpec = { ...proj.canvasSpec };
      const pixels = canvasPixels(this.canvasSpec);
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
        const layer = await restoreLayerFrom(pl, { artboard: eng.artboard }, index);
        if (layer) layers.push(layer);
      }
      if (!layers.some((l) => l.type === 'raster')) {
        const fallback = createRasterLayer('レイヤー 1', eng.artboard.w, eng.artboard.h);
        layers.push(fallback);
        proj.rootLayerIds.push(fallback.id);
      }
      if (!validateLayerTree(proj.rootLayerIds, layers)) throw new Error('invalid layer tree');
      ls.layers = layers;
      ls.rootLayerIds = [...proj.rootLayerIds];
      ls.activeLayerId = proj.activeLayerId ?? '';
      ls.resetCountersFromLayers();
      eng.history = new HistoryTree();
      if (isPersistedHistory(proj.history)) eng.history.restore(proj.history);
      for (const l of layers) ls.bumpLayer(l.id);
      useStore.getState().set({
        penColor: archive.meta.penColor,
        penSize: archive.meta.penSize,
        colorHistory: Array.isArray(archive.meta.colorHistory)
          ? archive.meta.colorHistory
          : useStore.getState().colorHistory,
        canvasW: eng.artboard.w,
        canvasH: eng.artboard.h,
        canvasSpec: { ...this.canvasSpec },
        clipboardAvailable: false,
        activePageId: pages.activePageId,
        pages: pages.pageOrder.map(id => ({ id, thumbnailVersion: archive.pages.find(page => page.id === id)?.thumbnailVersion ?? 0 })),
      });
      this.restoreTools(archive.meta.tools, archive.meta.activeToolId, archive.meta.toolLayout, archive.meta.toolStacks);
      ls.fixActive();
      eng.compositor.syncTextRenders();
    } catch (error) {
      await loadFonts(previousFonts);
      useStore.getState().set({ fonts: previousFonts });
      await this.restoreCanvasSnapshot(before);
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
