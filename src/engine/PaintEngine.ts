import { useStore } from '../state/store';
import {
  ART_H,
  ART_W,
  DEFAULT_ADJUST,
  DEFAULT_CANVAS,
  normalizePenDetailSettings,
  normalizeTextToolSettings,
  setArtSize,
  TRANSPARENT,
  type LayerMeta,
  type ShapeParams,
  type StrokePoint,
  type ToolInstance,
  type ToolKind,
  type TextParams,
  type CanvasSpec,
  type ProjectFont,
} from '../types';
import { checkerPattern, rectValid, type DirtyRect } from './brush';
import {
  HistoryTree,
  type HistoryNode,
  type LayerLocation,
  type LegacyLayerMergeOp,
  type LocatedLayerSnapshot,
  type LayerProps,
  type LayerSnapshot,
  type Op,
  type TileLayerMergeOp,
  type CanvasSnapshot,
} from './history/historyTree';
import { applyTiles, extractTiles, extractTilesBatched } from './history/tilePatch';
import {
  buildFilter,
  createAdjustLayer,
  createRasterLayer,
  createShapeLayer,
  createTextLayer,
  makeCanvas,
  type Layer,
  type RasterLayer,
  type ShapeLayer,
} from './layers';
import { drawShape, shapeBounds, shapeCenter, shapeCorners, rotateShape, translateShape } from './shapes';
import { canReparent, closestRasterOrRoot, structuralLowerId, validateLayerTree } from './layerTree';
import {
  deletePageData,
  getPersistenceUsage,
  hasClipboard,
  loadClipboard,
  loadPage,
  loadProject,
  loadProjectMeta,
  loadTimelapseEnabled,
  saveClipboard,
  savePage,
  saveProject,
  saveProjectMeta,
  saveTimelapseEnabled,
  setPersistencePageId,
  replaceProject,
  type LayerClipboard,
  type SavedPage,
  type SavedProject,
  type SavedLayer,
} from './persistence/db';
import {
  blobToDataURL,
  packProjectFile,
  unpackProjectFile,
} from './persistence/projectFile';
import { downloadBlob } from './timelapse/exporter';
import { TimelapseRecorder } from './timelapse/recorder';
import { BlurTool } from './tools/blur';
import { LassoTool } from './tools/lasso';
import { PenTool } from './tools/pen';
import { ShapeTool } from './tools/shape';
import { TextTool } from './tools/text';
import { TextRenderer, loadFonts } from './text/render';
import { isEmptyText } from './text/model';
import { canvasPixels, validateCanvasSpec, scaleShape, pngWithPpi } from './canvasSpec';
import type { Tool } from './tools/types';
import { ViewController, type ViewState } from './view';

interface Loupe {
  x: number;
  y: number;
  pointerId: number;
  color: string;
}

interface Gesture {
  id1: number;
  id2: number;
  start: ViewState;
  c0: { x: number; y: number };
  d0: number;
  a0: number;
}

interface PanDrag {
  id: number;
  lastX: number;
  lastY: number;
}

interface PendingPress {
  pointerId: number;
  start: StrokePoint;
  latest: StrokePoint;
  startClientX: number;
  startClientY: number;
  timer: ReturnType<typeof setTimeout>;
}

interface ShapeEdit {
  layerId: string;
  mode: 'move' | 'rotate' | 'start' | 'end' | 'nw' | 'ne' | 'sw' | 'se';
  start: StrokePoint;
  before: ShapeParams;
}
export interface SelectedObjectTransform { id: string; before: LayerProps; width?: number; height?: number }

function toBlobP(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}

const EYEDROPPER_HOLD_MS = 500;
const EYEDROPPER_MOVE_TOLERANCE_PX = 12;

export class PaintEngine {
  private layers: Layer[] = [];
  private rootLayerIds: string[] = [];
  private activeLayerId = '';
  private shapeEdit: ShapeEdit | null = null;
  private versions = new Map<string, number>();
  private layerCounter = 0;
  private adjustCounter = 0;
  private canvasSpec: CanvasSpec = { ...DEFAULT_CANVAS };
  private textRenderer = new TextRenderer();
  private projectGeneration = 0;
  private pageOrder: string[] = [];
  private activePageId = '';
  private thumbnailVersion = 0;

  private main: HTMLCanvasElement | null = null;
  private mainCtx: CanvasRenderingContext2D | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  /** ストローク開始時のレイヤー内容 (履歴パッチの before 側) */
  private scratch = makeCanvas();
  private scratchCtx = this.scratch.getContext('2d', { willReadFrequently: true })!;
  /** 調整レイヤー適用用の作業キャンバス */
  private tmp = makeCanvas();
  private tmpCtx = this.tmp.getContext('2d')!;
  /** 透明図形を直親ラスターだけへ非破壊で反映する作業キャンバス */
  private shapeTmp = makeCanvas();
  private shapeTmpCtx = this.shapeTmp.getContext('2d')!;
  private maskTmp = makeCanvas();
  private maskTmpCtx = this.maskTmp.getContext('2d')!;

  private history = new HistoryTree();
  private recorder = new TimelapseRecorder(this, () => this.scheduleStorageRefresh());

  readonly lasso = new LassoTool(this);
  private tools: Record<ToolKind, Tool> = {
    pen: new PenTool(this),
    line: new ShapeTool(this, 'line'),
    rect: new ShapeTool(this, 'rect'),
    ellipse: new ShapeTool(this, 'ellipse'),
    lasso: this.lasso,
    blur: new BlurTool(this),
    text: new TextTool(this),
  };

  private dirty = true;
  private raf = 0;
  private busy = false;
  private activePointer: number | null = null;
  /** 長押しスポイトか通常描画かが確定するまでの入力 */
  private pendingPress: PendingPress | null = null;
  private loupe: Loupe | null = null;

  readonly view = new ViewController();
  private area: HTMLElement | null = null;
  /** 現在触れているタッチポインタの位置 (2本指ジェスチャ判定用) */
  private touchPts = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private panDrag: PanDrag | null = null;
  private spaceDown = false;

  private initPromise: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  private saveRevision = 0;
  private persistedRevision = 0;
  private saving: Promise<void> | null = null;
  private storageTimer: ReturnType<typeof setTimeout> | null = null;
  private mergeCompactions = new Set<Promise<void>>();
  private lastViewState: ViewState = this.view.snapshot();

  constructor() {
    useStore.subscribe((s, prev) => {
      if (
        s.penColor !== prev.penColor ||
        s.penSize !== prev.penSize ||
        s.colorHistory !== prev.colorHistory ||
        s.tools !== prev.tools ||
        s.toolLayout !== prev.toolLayout ||
        s.toolStacks !== prev.toolStacks ||
        s.activeToolId !== prev.activeToolId
      ) {
        this.scheduleSave();
      }
    });
    this.view.onChange = () => {
      const view = this.view.snapshot();
      const st = useStore.getState();
      if (st.viewScale !== this.view.scale || st.viewRot !== this.view.rot) {
        st.set({ viewScale: this.view.scale, viewRot: this.view.rot });
      }
      if (
        view.x !== this.lastViewState.x ||
        view.y !== this.lastViewState.y ||
        view.scale !== this.lastViewState.scale ||
        view.rot !== this.lastViewState.rot
      ) {
        this.lastViewState = view;
        this.scheduleSave();
      }
    };
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  // ---------------------------------------------------------------- attach

  attach(
    main: HTMLCanvasElement,
    overlay: HTMLCanvasElement,
    wrapper: HTMLElement,
    area: HTMLElement,
  ): void {
    this.main = main;
    this.mainCtx = main.getContext('2d', { willReadFrequently: true })!;
    this.overlayCtx = overlay.getContext('2d')!;
    this.area = area;
    this.view.attach(area, wrapper);
    area.addEventListener('pointerdown', this.onPointerDown);
    area.addEventListener('pointermove', this.onPointerMove);
    area.addEventListener('pointerup', this.onPointerUp);
    area.addEventListener('pointercancel', this.onPointerCancel);
    area.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.raf = requestAnimationFrame(this.loop);
    void this.init().then(() => {
      this.requestRender();
      this.syncStore();
    });
  }

  detach(): void {
    const a = this.area;
    if (a) {
      a.removeEventListener('pointerdown', this.onPointerDown);
      a.removeEventListener('pointermove', this.onPointerMove);
      a.removeEventListener('pointerup', this.onPointerUp);
      a.removeEventListener('pointercancel', this.onPointerCancel);
      a.removeEventListener('wheel', this.onWheel);
    }
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.view.detach();
    this.touchPts.clear();
    this.gesture = null;
    this.panDrag = null;
    this.clearPendingPress();
    this.main = null;
    this.mainCtx = null;
    this.overlayCtx = null;
    this.area = null;
  }

  /** キャンバス領域にフィットさせたときのアートボード表示幅 (CSS px) */
  setFitWidth(w: number): void {
    this.view.setFitWidth(w);
  }

  resetView(): void {
    this.view.reset();
  }

  private init(): Promise<void> {
    this.initPromise ??= this.doInit();
    return this.initPromise;
  }

  /** ART サイズ変更後に作業キャンバスを追従させる */
  private syncWorkCanvases(): void {
    for (const c of [this.scratch, this.tmp, this.shapeTmp, this.maskTmp]) {
      if (c.width !== ART_W || c.height !== ART_H) {
        c.width = ART_W;
        c.height = ART_H;
      }
    }
  }

  /** 保存データのツールインスタンスを検証して store に反映する */
  private restoreTools(tools: unknown, activeToolId: unknown, toolLayout?: unknown, toolStacks?: unknown): void {
    if (!Array.isArray(tools)) return;
    const kinds: ToolKind[] = ['pen', 'line', 'rect', 'ellipse', 'lasso', 'blur', 'text'];
    const valid = tools.filter(
      (t): t is ToolInstance =>
        !!t &&
        typeof t.id === 'string' &&
        kinds.includes(t.kind) &&
        typeof t.name === 'string' &&
        typeof t.size === 'number' &&
        typeof t.color === 'string',
    ).map((tool) => {
      if (tool.kind === 'pen') return { ...tool, penSettings: normalizePenDetailSettings(tool.penSettings) };
      if (tool.kind === 'text') return { ...tool, textSettings: normalizeTextToolSettings(tool.textSettings) };
      return tool;
    });
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

  private newPageId(): string { return `P${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`; }

  private async restoreSavedPage(page: SavedPage): Promise<void> {
    this.layers = [];
    this.rootLayerIds = [...page.rootLayerIds];
    this.canvasSpec = { ...page.canvasSpec };
    const pixels = canvasPixels(this.canvasSpec);
    setArtSize(pixels.width, pixels.height);
    this.syncWorkCanvases();
    for (const sl of page.layers) {
      let layer: Layer;
      if (sl.type === 'raster') {
        const raster = createRasterLayer(sl.name, sl.id);
        if (sl.blob) { const bmp = await createImageBitmap(sl.blob); raster.ctx.drawImage(bmp, 0, 0); bmp.close(); }
        layer = raster;
      } else if (sl.type === 'adjust') {
        const adjust = createAdjustLayer(sl.name, sl.id);
        adjust.params = { ...(sl.params ?? DEFAULT_ADJUST) };
        adjust.maskLayerIds = [...(sl.maskLayerIds ?? [])];
        layer = adjust;
      } else if (sl.type === 'text' && sl.text) {
        layer = createTextLayer(sl.name, { ...structuredClone(sl.text), rotation: sl.text.rotation ?? 0 }, sl.id);
      } else if (sl.shape) {
        layer = createShapeLayer(sl.name, { ...sl.shape, ...(sl.shape.kind === 'line' ? {} : { rotation: sl.shape.rotation ?? 0 }) }, sl.id);
      } else continue;
      Object.assign(layer, { opacity: sl.opacity, blend: sl.blend, visible: sl.visible, parentId: sl.parentId, childIds: [...sl.childIds] });
      this.layers.push(layer);
    }
    if (!validateLayerTree(this.rootLayerIds, this.layers)) throw new Error('invalid layer tree');
    this.activeLayerId = page.activeLayerId;
    this.history = new HistoryTree();
    this.history.restore(page.history);
    this.view.restore(page.view);
    this.thumbnailVersion = page.thumbnailVersion;
    this.layerCounter = this.layers.filter(layer => layer.type === 'raster').length;
    this.adjustCounter = this.layers.filter(layer => layer.type === 'adjust').length;
    this.versions.clear();
    this.textRenderer.clear();
    this.fixActive();
    this.syncTextRenders();
  }

  private async doInit(): Promise<void> {
    let restoredHistory: unknown;
    let restoredView: unknown;
    try {
      useStore.getState().set({ timelapseEnabled: await loadTimelapseEnabled() });
    } catch {
      // 設定を読めない場合も、既定値のオンでプロジェクト復元を続ける。
    }
    try {
      const proj = await loadProject();
      if (proj?.version === 4 && proj.layers.length > 0 && !validateCanvasSpec(proj.canvasSpec)) {
        this.pageOrder = [...proj.pageOrder];
        this.activePageId = proj.activePageId;
        this.thumbnailVersion = proj.thumbnailVersion;
        setPersistencePageId(this.activePageId);
        this.canvasSpec = { ...proj.canvasSpec };
        const pixels = canvasPixels(this.canvasSpec);
        setArtSize(pixels.width, pixels.height);
        await loadFonts(proj.fonts);
        useStore.getState().set({ fonts: proj.fonts, canvasSpec: { ...this.canvasSpec } });
        this.syncWorkCanvases();
        for (const sl of proj.layers) {
          if (sl.type === 'raster') {
            const l = createRasterLayer(sl.name, sl.id);
            l.opacity = sl.opacity;
            l.blend = sl.blend;
            l.visible = sl.visible;
            if (sl.blob) {
              const bmp = await createImageBitmap(sl.blob);
              l.ctx.drawImage(bmp, 0, 0);
              bmp.close();
            }
            l.parentId = sl.parentId;
            l.childIds = [...sl.childIds];
            this.layers.push(l);
            this.layerCounter++;
          } else if (sl.type === 'adjust') {
            const l = createAdjustLayer(sl.name, sl.id);
            l.opacity = sl.opacity;
            l.blend = sl.blend;
            l.visible = sl.visible;
            l.params = { ...(sl.params ?? DEFAULT_ADJUST) };
            l.maskLayerIds = [...(sl.maskLayerIds ?? [])];
            l.parentId = sl.parentId;
            l.childIds = [...sl.childIds];
            this.layers.push(l);
            this.adjustCounter++;
          } else if (sl.type === 'text' && sl.text) {
            const l = createTextLayer(sl.name, sl.text, sl.id);
            Object.assign(l, { opacity: sl.opacity, blend: sl.blend, visible: sl.visible, parentId: sl.parentId, childIds: [...sl.childIds] });
            this.layers.push(l);
          } else if (sl.shape) {
            const l = createShapeLayer(sl.name, { ...sl.shape }, sl.id);
            l.opacity = sl.opacity;
            l.blend = sl.blend;
            l.visible = sl.visible;
            l.parentId = sl.parentId;
            l.childIds = [...sl.childIds];
            this.layers.push(l);
          }
        }
        this.rootLayerIds = [...proj.rootLayerIds];
        if (!validateLayerTree(this.rootLayerIds, this.layers)) throw new Error('invalid layer tree');
        this.activeLayerId = proj.activeLayerId;
        useStore.getState().set({
          penColor: proj.penColor,
          penSize: proj.penSize,
          colorHistory: proj.colorHistory,
          canvasW: ART_W,
          canvasH: ART_H,
        });
        this.restoreTools(proj.tools, proj.activeToolId, proj.toolLayout, proj.toolStacks);
        restoredHistory = proj.history;
        restoredView = proj.view;
      }
    } catch {
      // 復元に失敗したら新規プロジェクトで開始
      this.layers = [];
    }
    if (this.layers.length === 0) {
      const l = createRasterLayer('レイヤー 1');
      this.layers.push(l);
      this.rootLayerIds = [l.id];
      this.activeLayerId = l.id;
      this.layerCounter = 1;
      this.activePageId = this.newPageId();
      this.pageOrder = [this.activePageId];
      setPersistencePageId(this.activePageId);
    }
    this.fixActive();
    if (restoredHistory) this.history.restore(restoredHistory);
    if (restoredView) this.view.restore(restoredView);
    this.lastViewState = this.view.snapshot();
    this.initialized = true;
    useStore.getState().set({
      pages: this.pageOrder.map(id => ({ id, thumbnailVersion: id === this.activePageId ? this.thumbnailVersion : 0 })),
      activePageId: this.activePageId,
      clipboardAvailable: await hasClipboard().catch(() => false),
    });
    this.syncTextRenders();
    this.scheduleStorageRefresh();
    this.scheduleSave();
  }

  // ---------------------------------------------------------------- render

  requestRender(): void {
    this.dirty = true;
  }

  ensureComposited(): void {
    if (this.dirty) this.composite();
  }

  private syncTextRenders(): void {
    this.textRenderer.retain(new Set(this.layers.filter(l => l.type === 'text').map(l => l.id)));
    for (const layer of this.layers) if (layer.type === 'text') {
      this.textRenderer.request(layer.id, layer.text, this.canvasSpec.ppi, () => { this.bumpLayer(layer.id); this.syncStore(); });
    }
  }
  async readyToRender(): Promise<void> {
    this.syncTextRenders();
    await this.textRenderer.ready();
    this.ensureComposited();
  }

  compositeCanvas(): HTMLCanvasElement | null {
    return this.main;
  }

  uiScale(): number {
    return 1 / this.view.displayScale();
  }

  private loop = (): void => {
    if (this.dirty) this.composite();
    this.drawOverlayFrame();
    this.raf = requestAnimationFrame(this.loop);
  };

  private composite(): void {
    const ctx = this.mainCtx;
    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ART_W, ART_H);
    const tool = this.activeTool();
    const render = (id: string) => {
      const l = this.byId(id);
      if (!l) return;
      if (l.visible && l.type === 'raster') {
        let source: HTMLCanvasElement = l.canvas;
        const erasers = l.childIds
          .map((childId) => this.shapeById(childId))
          .filter((child): child is ShapeLayer => !!child && child.visible && child.shape.color === TRANSPARENT);
        if (erasers.length) {
          this.shapeTmpCtx.save();
          this.shapeTmpCtx.clearRect(0, 0, ART_W, ART_H);
          this.shapeTmpCtx.globalAlpha = 1;
          this.shapeTmpCtx.globalCompositeOperation = 'source-over';
          this.shapeTmpCtx.drawImage(l.canvas, 0, 0);
          for (const eraser of erasers) {
            this.shapeTmpCtx.globalAlpha = eraser.opacity;
            drawShape(this.shapeTmpCtx, eraser.shape);
          }
          this.shapeTmpCtx.restore();
          source = this.shapeTmp;
        }
        ctx.globalAlpha = l.opacity;
        ctx.globalCompositeOperation = l.blend;
        ctx.drawImage(source, 0, 0);
        if (tool === this.lasso) this.lasso.drawAboveLayerFor(ctx, l.id);
        else if (l.id === this.activeLayerId) tool.drawAboveLayer?.(ctx);
      } else if (l.visible && l.type === 'shape' && l.shape.color !== TRANSPARENT) {
        ctx.globalAlpha = l.opacity;
        ctx.globalCompositeOperation = l.blend;
        drawShape(ctx, l.shape);
      } else if (l.visible && l.type === 'text') {
        ctx.globalAlpha = l.opacity;
        ctx.globalCompositeOperation = l.blend;
        this.textRenderer.draw(ctx, l.id, l.text);
      } else if (l.visible && l.type === 'adjust') {
        this.tmpCtx.save();
        this.tmpCtx.clearRect(0, 0, ART_W, ART_H);
        this.tmpCtx.filter = buildFilter(l.params);
        this.tmpCtx.drawImage(this.main!, 0, 0);
        this.tmpCtx.restore();
        if (l.maskLayerIds.length) {
          this.maskTmpCtx.save();
          this.maskTmpCtx.clearRect(0, 0, ART_W, ART_H);
          this.maskTmpCtx.globalCompositeOperation = 'source-over';
          for (const sourceId of l.maskLayerIds) {
            const source = this.byId(sourceId);
            if (!source?.visible || source.type === 'adjust') continue;
            this.maskTmpCtx.globalAlpha = source.opacity;
            if (source.type === 'raster') this.maskTmpCtx.drawImage(source.canvas, 0, 0);
            else if (source.type === 'shape' && source.shape.color !== TRANSPARENT) {
              const shape = source.shape.kind === 'line' ? { ...source.shape, color: '#fff' } : { ...source.shape, color: '#fff' };
              drawShape(this.maskTmpCtx, shape);
            } else if (source.type === 'text') this.textRenderer.draw(this.maskTmpCtx, source.id, source.text);
          }
          this.maskTmpCtx.restore();
          this.tmpCtx.save();
          this.tmpCtx.globalCompositeOperation = 'destination-in';
          this.tmpCtx.globalAlpha = 1;
          this.tmpCtx.drawImage(this.maskTmp, 0, 0);
          this.tmpCtx.restore();
        }
        ctx.globalAlpha = l.opacity;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(this.tmp, 0, 0);
      }
      for (const childId of l.childIds) render(childId);
    };
    for (const id of this.rootLayerIds) {
      render(id);
    }
    ctx.restore();
    this.dirty = false;
  }

  private drawOverlayFrame(): void {
    const ctx = this.overlayCtx;
    if (!ctx) return;
    ctx.clearRect(0, 0, ART_W, ART_H);
    this.activeTool().drawOverlay?.(ctx);
    this.drawActiveShapeHandles(ctx);
    if (this.loupe) this.drawLoupe(ctx);
  }

  // ---------------------------------------------------------------- pointer

  private toPoint(e: { clientX: number; clientY: number; pressure?: number; pointerType?: string }): StrokePoint {
    const { x, y } = this.view.clientToArt(e.clientX, e.clientY);
    const pressure =
      e.pointerType === 'mouse' ? 1 : e.pressure && e.pressure > 0 ? e.pressure : 0.5;
    return { x, y, pressure };
  }

  private activeTool(): Tool {
    const kind = useStore.getState().tool;
    return kind ? this.tools[kind] : this.nullTool;
  }

  private readonly nullTool: Tool = {
    onDown: () => undefined,
    onMove: () => undefined,
    onUp: () => undefined,
  };

  /** キャンバス上に重ねた UI (選択ツールバー等) の操作は無視する */
  private isUiTarget(e: Event): boolean {
    const t = e.target as Element | null;
    return !!t && !!t.closest('button, [data-canvas-ui]');
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.isUiTarget(e)) return;
    if (useStore.getState().textEditingId) this.finishTextEditing();
    // パン (中ボタン / Space+左ドラッグ)
    if (
      e.pointerType === 'mouse' &&
      (e.button === 1 || (e.button === 0 && this.spaceDown))
    ) {
      this.panDrag = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      this.area?.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.pointerType === 'touch') {
      this.touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.gesture) return;
      if (this.touchPts.size === 2) {
        this.beginGesture(e);
        return;
      }
      if (this.touchPts.size > 2) return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.loupe) return;
    if (this.busy || this.activePointer !== null) return;
    const p = this.toPoint(e);
    this.activePointer = e.pointerId;
    this.area?.setPointerCapture(e.pointerId);
    const pointerId = e.pointerId;
    this.pendingPress = {
      pointerId,
      start: p,
      latest: p,
      startClientX: e.clientX,
      startClientY: e.clientY,
      timer: setTimeout(() => {
        const pending = this.pendingPress;
        if (!pending || pending.pointerId !== pointerId || this.activePointer !== pointerId) {
          return;
        }
        this.pendingPress = null;
        this.activePointer = null;
        const point = pending.latest;
        this.loupe = {
          x: point.x,
          y: point.y,
          pointerId,
          color: this.getPixel(point.x, point.y),
        };
      }, EYEDROPPER_HOLD_MS),
    };
    e.preventDefault();
  };

  // ------------------------------------------------ view gestures

  /** 2本目の指が触れた → 描画をやめてパン/回転/拡縮ジェスチャへ */
  private beginGesture(e: PointerEvent): void {
    if (this.activePointer !== null && this.touchPts.has(this.activePointer)) {
      if (this.pendingPress?.pointerId === this.activePointer) {
        this.clearPendingPress();
      } else {
        this.activeTool().cancel?.();
      }
      this.activePointer = null;
      this.requestRender();
    }
    this.loupe = null;
    const [[id1, p1], [id2, p2]] = [...this.touchPts.entries()];
    this.gesture = {
      id1,
      id2,
      start: this.view.snapshot(),
      c0: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      d0: Math.hypot(p2.x - p1.x, p2.y - p1.y),
      a0: Math.atan2(p2.y - p1.y, p2.x - p1.x),
    };
    this.area?.setPointerCapture(id1);
    this.area?.setPointerCapture(id2);
    e.preventDefault();
  }

  private updateGesture(): void {
    const g = this.gesture;
    if (!g) return;
    const p1 = this.touchPts.get(g.id1);
    const p2 = this.touchPts.get(g.id2);
    if (!p1 || !p2) return;
    this.view.applyGesture(
      g.start,
      g.c0,
      g.d0,
      g.a0,
      { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      Math.hypot(p2.x - p1.x, p2.y - p1.y),
      Math.atan2(p2.y - p1.y, p2.x - p1.x),
    );
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // ピンチ (trackpad) / Ctrl+ホイール → ズーム
      this.view.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
    } else if (e.shiftKey) {
      const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      this.view.rotateAt(e.clientX, e.clientY, d * 0.003);
    } else {
      this.view.panBy(-e.deltaX, -e.deltaY);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' && this.touchPts.has(e.pointerId)) {
      this.touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (this.panDrag && this.panDrag.id === e.pointerId) {
      this.view.panBy(e.clientX - this.panDrag.lastX, e.clientY - this.panDrag.lastY);
      this.panDrag.lastX = e.clientX;
      this.panDrag.lastY = e.clientY;
      return;
    }
    if (this.gesture && (e.pointerId === this.gesture.id1 || e.pointerId === this.gesture.id2)) {
      this.updateGesture();
      return;
    }
    if (this.loupe && e.pointerId === this.loupe.pointerId) {
      const p = this.toPoint(e);
      this.loupe.x = Math.max(0, Math.min(ART_W - 1, p.x));
      this.loupe.y = Math.max(0, Math.min(ART_H - 1, p.y));
      this.loupe.color = this.getPixel(this.loupe.x, this.loupe.y);
      return;
    }
    if (this.activePointer !== e.pointerId) return;
    const pending = this.pendingPress;
    if (pending && pending.pointerId === e.pointerId) {
      pending.latest = this.toPoint(e);
      const moved = Math.hypot(
        e.clientX - pending.startClientX,
        e.clientY - pending.startClientY,
      );
      if (moved <= EYEDROPPER_MOVE_TOLERANCE_PX) return;
      clearTimeout(pending.timer);
      this.pendingPress = null;
      if (!this.beginShapeEdit(pending.start, e)) this.activeTool().onDown(pending.start, e);
    }
    if (this.shapeEdit) {
      this.updateShapeEdit(this.toPoint(e), e);
      return;
    }
    const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const events = coalesced.length > 0 ? coalesced : [e];
    const tool = this.activeTool();
    for (const ev of events) tool.onMove(this.toPoint(ev), ev);
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.touchPts.delete(e.pointerId);
    if (this.panDrag && this.panDrag.id === e.pointerId) {
      this.panDrag = null;
      return;
    }
    if (this.gesture && (e.pointerId === this.gesture.id1 || e.pointerId === this.gesture.id2)) {
      this.gesture = null;
      return;
    }
    if (this.loupe && e.pointerId === this.loupe.pointerId) {
      const color = this.loupe.color;
      this.loupe = null;
      const st = useStore.getState();
      st.setPenColor(color);
      st.pushColor(color);
      return;
    }
    if (this.activePointer !== e.pointerId) return;
    this.activePointer = null;
    if (this.shapeEdit) {
      this.finishShapeEdit(this.toPoint(e));
      return;
    }
    const pending = this.pendingPress;
    if (pending && pending.pointerId === e.pointerId) {
      clearTimeout(pending.timer);
      this.pendingPress = null;
      const tool = this.activeTool();
      if (this.beginShapeEdit(pending.start, e)) this.finishShapeEdit(this.toPoint(e));
      else {
        tool.onDown(pending.start, e);
        tool.onUp(this.toPoint(e), e);
      }
      return;
    }
    this.activeTool().onUp(this.toPoint(e), e);
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.touchPts.delete(e.pointerId);
    if (this.panDrag && this.panDrag.id === e.pointerId) {
      this.panDrag = null;
      return;
    }
    if (this.gesture && (e.pointerId === this.gesture.id1 || e.pointerId === this.gesture.id2)) {
      this.gesture = null;
      return;
    }
    if (this.loupe && e.pointerId === this.loupe.pointerId) {
      this.loupe = null;
      return;
    }
    if (this.activePointer !== e.pointerId) return;
    this.activePointer = null;
    if (this.pendingPress?.pointerId === e.pointerId) {
      this.clearPendingPress();
      return;
    }
    if (this.shapeEdit) {
      this.cancelShapeEdit();
      return;
    }
    this.activeTool().cancel?.();
    this.requestRender();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable="true"], [data-text-controls]')) return;
    const meta = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (meta && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) void this.redo();
      else void this.undo();
    } else if (meta && key === 'y') {
      e.preventDefault();
      void this.redo();
    } else if (meta && key === 'c') {
      e.preventDefault();
      void this.copyLayers();
    } else if (meta && key === 'v') {
      e.preventDefault();
      void this.pasteLayers();
    } else if (meta && key === '0') {
      e.preventDefault();
      this.view.reset();
    } else if (e.code === 'Space') {
      if (!this.spaceDown) {
        this.spaceDown = true;
        if (this.area) this.area.style.cursor = 'grab';
      }
      if (e.target === document.body) e.preventDefault();
    } else if (e.key === 'Escape') {
      this.loupe = null;
      this.lassoCancel();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.spaceDown = false;
      if (this.area) this.area.style.cursor = '';
    }
  };

  // ---------------------------------------------------------------- eyedropper

  private clearPendingPress(): void {
    if (!this.pendingPress) return;
    clearTimeout(this.pendingPress.timer);
    this.pendingPress = null;
  }

  /** アクティブレイヤーだけから色を拾う。アルファがほぼ0なら「透明」 */
  getPixel(x: number, y: number): string {
    const layer = this.rasterById(this.activeLayerId);
    if (!layer) return TRANSPARENT;
    const cx = Math.max(0, Math.min(ART_W - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(ART_H - 1, Math.round(y)));
    const d = layer.ctx.getImageData(cx, cy, 1, 1).data;
    if (d[3] < 128) return TRANSPARENT;
    const hex = (v: number) => v.toString(16).padStart(2, '0');
    return `#${hex(d[0])}${hex(d[1])}${hex(d[2])}`;
  }

  private drawLoupe(ctx: CanvasRenderingContext2D): void {
    const lp = this.loupe!;
    const s = this.uiScale();
    const R = 56 * s;
    const zoom = 7;
    let cx = lp.x;
    let cy = lp.y - 96 * s;
    if (cy - R - 14 * s < 0) cy = lp.y + 96 * s;
    cx = Math.max(R + 10 * s, Math.min(ART_W - R - 10 * s, cx));
    this.ensureComposited();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.imageSmoothingEnabled = false;
    const srcR = R / zoom;
    ctx.drawImage(
      this.main!,
      lp.x - srcR,
      lp.y - srcR,
      srcR * 2,
      srcR * 2,
      cx - R,
      cy - R,
      R * 2,
      R * 2,
    );
    ctx.restore();

    const ch = 7 * s;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    ctx.moveTo(cx - ch, cy);
    ctx.lineTo(cx + ch, cy);
    ctx.moveTo(cx, cy - ch);
    ctx.lineTo(cx, cy + ch);
    ctx.stroke();

    ctx.lineWidth = 9 * s;
    ctx.strokeStyle = lp.color === TRANSPARENT ? checkerPattern(ctx) : lp.color;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 5 * s, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 1.5 * s;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(cx, cy, R + 9.5 * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R + 0.5 * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(lp.x, lp.y, 3 * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- stroke helpers

  activeRaster(): RasterLayer | null {
    const l = this.byId(this.activeLayerId);
    return l && l.type === 'raster' && l.visible ? l : null;
  }

  selectedRasters(): RasterLayer[] {
    const state = useStore.getState();
    const ids = state.multiSelectMode ? new Set(state.selectedLayerIds) : new Set([this.activeLayerId]);
    return this.layers.filter((layer): layer is RasterLayer => layer.type === 'raster' && layer.visible && ids.has(layer.id));
  }

  hasSelectedObjects(): boolean {
    const ids = new Set(useStore.getState().selectedLayerIds);
    return this.layers.some(layer => ids.has(layer.id) && (layer.type === 'shape' || layer.type === 'text'));
  }

  selectedObjectsInRect(rect: DirtyRect, polygon?: { x: number; y: number }[]): SelectedObjectTransform[] {
    const ids = new Set(useStore.getState().selectedLayerIds);
    const pointInPolygon = (point: { x: number; y: number }) => {
      if (!polygon?.length) return true;
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    };
    const intersectsPolygon = (bounds: { x: number; y: number; w: number; h: number }) => {
      if (!polygon?.length) return true;
      const corners = [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.w, y: bounds.y }, { x: bounds.x + bounds.w, y: bounds.y + bounds.h }, { x: bounds.x, y: bounds.y + bounds.h }];
      if (polygon.some(point => point.x >= bounds.x && point.x <= bounds.x + bounds.w && point.y >= bounds.y && point.y <= bounds.y + bounds.h) || corners.some(pointInPolygon)) return true;
      const cross = (a: {x:number;y:number}, b: {x:number;y:number}, c: {x:number;y:number}) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
      for (let i = 0; i < polygon.length; i++) for (let j = 0; j < 4; j++) { const a=polygon[i], b=polygon[(i+1)%polygon.length], c=corners[j], d=corners[(j+1)%4]; if (cross(a,b,c)*cross(a,b,d)<=0 && cross(c,d,a)*cross(c,d,b)<=0) return true; }
      return false;
    };
    return this.layers.flatMap(layer => {
      if (!ids.has(layer.id) || (layer.type !== 'shape' && layer.type !== 'text')) return [];
      let bounds: { x: number; y: number; w: number; h: number };
      let width: number | undefined, height: number | undefined;
      if (layer.type === 'shape') bounds = shapeBounds(layer.shape);
      else {
        const canvas = this.textRenderer.get(layer.id);
        width = layer.text.width ?? Math.max(24, Number(canvas?.dataset.textWidth ?? 100));
        height = layer.text.height ?? Math.max(24, Number(canvas?.dataset.textHeight ?? 60));
        bounds = { x: layer.text.x, y: layer.text.y, w: width, h: height };
      }
      if (bounds.x > rect.maxX || bounds.y > rect.maxY || bounds.x + bounds.w < rect.minX || bounds.y + bounds.h < rect.minY || !intersectsPolygon(bounds)) return [];
      return [{ id: layer.id, before: layer.type === 'shape' ? { shape: { ...layer.shape } } : { text: structuredClone(layer.text) }, width, height }];
    });
  }

  previewObjectGroup(entries: SelectedObjectTransform[], source: { x: number; y: number }[], target: { x: number; y: number }[]): void {
    if (source.length < 4 || target.length < 4) return;
    const src = { x: (source[0].x + source[2].x) / 2, y: (source[0].y + source[2].y) / 2 };
    const dst = { x: (target[0].x + target[2].x) / 2, y: (target[0].y + target[2].y) / 2 };
    const srcEdge = { x: source[1].x - source[0].x, y: source[1].y - source[0].y };
    const dstEdge = { x: target[1].x - target[0].x, y: target[1].y - target[0].y };
    const scale = Math.max(.01, Math.hypot(dstEdge.x, dstEdge.y) / Math.max(.01, Math.hypot(srcEdge.x, srcEdge.y)));
    const angle = Math.atan2(dstEdge.y, dstEdge.x) - Math.atan2(srcEdge.y, srcEdge.x);
    const transform = (x: number, y: number) => { const dx = (x - src.x) * scale, dy = (y - src.y) * scale; return { x: dst.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: dst.y + dx * Math.sin(angle) + dy * Math.cos(angle) }; };
    for (const entry of entries) {
      const layer = this.byId(entry.id);
      if (layer?.type === 'shape' && entry.before.shape) {
        const shape = entry.before.shape;
        if (shape.kind === 'line') { const a = transform(shape.x1, shape.y1), b = transform(shape.x2, shape.y2); layer.shape = { ...shape, x1: a.x, y1: a.y, x2: b.x, y2: b.y, width: shape.width * scale }; }
        else if (shape.kind === 'rect') { const c = transform(shape.x + shape.width / 2, shape.y + shape.height / 2), w = shape.width * scale, h = shape.height * scale; layer.shape = { ...shape, x: c.x - w / 2, y: c.y - h / 2, width: w, height: h, strokeWidth: shape.strokeWidth * scale, rotation: (shape.rotation ?? 0) + angle }; }
        else { const c = transform(shape.cx, shape.cy); layer.shape = { ...shape, cx: c.x, cy: c.y, rx: shape.rx * scale, ry: shape.ry * scale, strokeWidth: shape.strokeWidth * scale, rotation: (shape.rotation ?? 0) + angle }; }
      } else if (layer?.type === 'text' && entry.before.text) {
        const text = entry.before.text, width = entry.width ?? text.width ?? 100, height = entry.height ?? text.height ?? 60;
        const center = transform(text.x + width / 2, text.y + height / 2), nextWidth = width * scale, nextHeight = height * scale;
        layer.text = { ...structuredClone(text), x: center.x - nextWidth / 2, y: center.y - nextHeight / 2, width: text.width === null ? null : nextWidth, height: text.height === null ? null : nextHeight, rotation: (text.rotation ?? 0) + angle, style: { ...text.style, sizePt: text.style.sizePt * scale }, ranges: text.ranges.map(range => ({ ...range, sizePt: range.sizePt * scale })) };
      }
      this.bumpLayer(entry.id);
    }
    this.syncTextRenders(); this.requestRender(); this.syncStore();
  }

  commitObjectGroup(entries: SelectedObjectTransform[]): void {
    const ops = entries.flatMap(entry => { const layer = this.byId(entry.id); if (!layer) return []; const after: LayerProps = layer.type === 'shape' ? { shape: { ...layer.shape } } : layer.type === 'text' ? { text: structuredClone(layer.text) } : {}; return [{ kind: 'layerProps' as const, layerId: entry.id, before: entry.before, after }]; });
    if (!ops.length) return;
    this.history.push(ops.length === 1 ? ops[0] : { kind: 'batch', ops }, '複数オブジェクトを変形'); this.committed();
  }

  restoreObjectGroup(entries: SelectedObjectTransform[]): void { for (const entry of entries) { const layer = this.byId(entry.id); if (layer) this.assignProps(layer, entry.before); } this.syncTextRenders(); this.requestRender(); this.syncStore(); }

  commitRasterBatch(entries: { layer: RasterLayer; before: HTMLCanvasElement; rect: DirtyRect }[], label: string, objects: SelectedObjectTransform[] = []): void {
    const operations: Extract<Op, { kind: 'batch' }>['ops'] = [];
    const ready: Promise<void>[] = [];
    for (const entry of entries) {
      if (!rectValid(entry.rect)) continue;
      const before = entry.before.getContext('2d', { willReadFrequently: true })!;
      const patch = extractTiles(before, entry.layer.ctx, entry.rect, ART_W, ART_H);
      if (!patch.tiles.length) continue;
      operations.push({ kind: 'raster', layerId: entry.layer.id, tiles: patch.tiles });
      ready.push(patch.ready); this.bumpLayer(entry.layer.id);
    }
    for (const entry of objects) {
      const layer = this.byId(entry.id);
      if (!layer) continue;
      const after: LayerProps = layer.type === 'shape' ? { shape: { ...layer.shape } } : layer.type === 'text' ? { text: structuredClone(layer.text) } : {};
      operations.push({ kind: 'layerProps', layerId: entry.id, before: entry.before, after });
    }
    if (!operations.length) return;
    const node = this.history.push(operations.length === 1 ? operations[0] : { kind: 'batch', ops: operations }, label);
    node.ready = Promise.all(ready).then(() => undefined);
    void node.ready.then(() => this.scheduleStorageRefresh());
    this.committed();
  }

  captureBefore(layer: RasterLayer): void {
    this.scratchCtx.clearRect(0, 0, ART_W, ART_H);
    this.scratchCtx.drawImage(layer.canvas, 0, 0);
  }

  restoreBefore(layer: RasterLayer): void {
    layer.ctx.clearRect(0, 0, ART_W, ART_H);
    layer.ctx.drawImage(this.scratch, 0, 0);
    this.bumpLayer(layer.id);
  }

  commitRasterEdit(
    layer: RasterLayer,
    rect: DirtyRect,
    label: string,
  ): void {
    if (!rectValid(rect)) return;
    const { tiles, ready } = extractTiles(this.scratchCtx, layer.ctx, rect, ART_W, ART_H);
    if (tiles.length === 0) return;
    const node = this.history.push({ kind: 'raster', layerId: layer.id, tiles }, label);
    node.ready = ready;
    void ready.then(() => this.scheduleStorageRefresh());
    this.bumpLayer(layer.id);
    this.committed();
  }

  // ---------------------------------------------------------------- history

  async undo(): Promise<void> {
    if (this.busy) return;
    if (this.finishTextEditing()) return;
    if (this.lasso.phase !== 'idle') {
      this.lasso.cancelSelection();
      this.scheduleSave();
      return;
    }
    const node = this.history.undo();
    if (!node) return;
    this.busy = true;
    try {
      if (node.op) {
        await node.ready;
        await this.applyOp(node.op, 'undo');
      }
    } finally {
      this.busy = false;
    }
    this.afterHistoryNav();
  }

  async redo(childIndex?: number): Promise<void> {
    if (this.busy) return;
    if (this.finishTextEditing()) return;
    if (this.lasso.phase !== 'idle') {
      this.lasso.cancelSelection();
      this.scheduleSave();
    }
    const node = this.history.redo(childIndex);
    if (!node) return;
    this.busy = true;
    try {
      if (node.op) {
        await node.ready;
        await this.applyOp(node.op, 'redo');
      }
    } finally {
      this.busy = false;
    }
    this.afterHistoryNav();
  }

  private afterHistoryNav(): void {
    this.fixActive();
    this.syncTextRenders();
    this.requestRender();
    this.syncStore();
    this.scheduleSave();
    // タイムラプスには undo/redo を記録しない
  }

  private async applyOp(op: Op, dir: 'undo' | 'redo'): Promise<void> {
    if (op.kind === 'batch') {
      const operations = dir === 'undo' ? [...op.ops].reverse() : op.ops;
      for (const item of operations) await this.applyOp(item, dir);
      return;
    }
    switch (op.kind) {
      case 'canvasChange': {
        await this.restoreCanvasSnapshot(dir === 'undo' ? op.before : op.after);
        break;
      }
      case 'raster': {
        const layer = this.rasterById(op.layerId);
        if (layer) {
          await applyTiles(layer, op.tiles, dir === 'undo' ? 'before' : 'after');
          this.bumpLayer(layer.id);
        }
        break;
      }
      case 'layerAdd': {
        if (dir === 'redo') { await this.restoreLayer(op.snapshot, op.location); this.activeLayerId = op.snapshot.id; }
        else this.removeLayerInternal(op.snapshot.id);
        break;
      }
      case 'layerRemove': {
        if (dir === 'undo') {
          const entries = op.snapshots.map((snapshot) => ({
            location: snapshot.id === op.snapshots[0].id ? op.location : { parentId: snapshot.parentId, index: 0 },
            snapshot,
          }));
          await this.restoreEntries(entries);
        } else this.removeLayerInternal(op.snapshots[0].id);
        break;
      }
      case 'layerMove': {
        const to = dir === 'redo' ? op.to : op.from;
        this.detachLayer(op.layerId);
        this.insertAt(op.layerId, to);
        break;
      }
      case 'layerProps': {
        const l = this.byId(op.layerId);
        if (l) this.assignProps(l, dir === 'undo' ? op.before : op.after);
        break;
      }
      case 'layerMerge': {
        const applyMaskChanges = () => { for (const change of op.maskChanges ?? []) { const layer = this.byId(change.layerId); if (layer?.type === 'adjust') layer.maskLayerIds = [...(dir === 'undo' ? change.before : change.after)]; } };
        if (op.format === 'tiles-v1') {
          const target = this.rasterById(op.targetLayerId);
          if (dir === 'undo') {
            if (target) {
              await applyTiles(target, op.tiles, 'before');
              this.bumpLayer(target.id);
            }
            if (!this.byId(op.removed.snapshot.id)) await this.restoreEntries([op.removed]);
          } else {
            this.removeLayerExact(op.removed.snapshot.id);
            if (target) {
              await applyTiles(target, op.tiles, 'after');
              this.bumpLayer(target.id);
            }
          }
          this.activeLayerId = dir === 'undo' ? op.beforeActiveId : op.afterActiveId;
          applyMaskChanges();
          break;
        }
        const remove = dir === 'undo' ? op.after : op.before;
        const restore = dir === 'undo' ? op.before : op.after;
        for (const entry of remove) this.removeLayerExact(entry.snapshot.id);
        await this.restoreEntries(restore);
        this.activeLayerId =
          dir === 'undo' ? op.beforeActiveId : op.afterActiveId;
        applyMaskChanges();
        break;
      }
    }
  }

  private committed(): void {
    this.syncTextRenders();
    this.requestRender();
    this.syncStore();
    this.recorder.schedule();
    this.scheduleSave();
    this.scheduleStorageRefresh();
  }

  isTimelapseEnabled(): boolean {
    return useStore.getState().timelapseEnabled;
  }

  setTimelapseEnabled(enabled: boolean): void {
    const st = useStore.getState();
    if (st.timelapseEnabled === enabled) return;
    st.set({ timelapseEnabled: enabled });
    this.recorder.setEnabled(enabled);
    void saveTimelapseEnabled(enabled).catch(() => {
      // 設定の保存失敗は描画を妨げない。
    });
  }

  pruneHistory(limit = 10): number {
    if (this.busy) return 0;
    const removed = this.history.pruneToRecent(limit);
    if (removed > 0) {
      this.syncStore();
      this.scheduleSave();
      this.scheduleStorageRefresh();
    }
    return removed;
  }

  // ---------------------------------------------------------------- layers

  private byId(id: string): Layer | null {
    return this.layers.find((l) => l.id === id) ?? null;
  }

  private rasterById(id: string): RasterLayer | null {
    const l = this.byId(id);
    return l && l.type === 'raster' ? l : null;
  }

  private shapeById(id: string): ShapeLayer | null {
    const l = this.byId(id);
    return l && l.type === 'shape' ? l : null;
  }

  private siblingIds(parentId: string | null): string[] {
    if (parentId === null) return this.rootLayerIds;
    return this.byId(parentId)?.childIds ?? [];
  }

  private locationOf(id: string): LayerLocation | null {
    const layer = this.byId(id);
    if (!layer) return null;
    const siblings = this.siblingIds(layer.parentId);
    const index = siblings.indexOf(id);
    return index < 0 ? null : { parentId: layer.parentId, index };
  }

  private insertAt(id: string, location: LayerLocation): void {
    const layer = this.byId(id);
    if (!layer) return;
    layer.parentId = location.parentId;
    const siblings = this.siblingIds(location.parentId);
    siblings.splice(Math.max(0, Math.min(location.index, siblings.length)), 0, id);
  }

  private detachLayer(id: string): LayerLocation | null {
    const location = this.locationOf(id);
    if (!location) return null;
    this.siblingIds(location.parentId).splice(location.index, 1);
    return location;
  }

  private descendantIds(id: string): string[] {
    const result: string[] = [];
    const visit = (layerId: string) => {
      const layer = this.byId(layerId);
      if (!layer) return;
      result.push(layerId);
      for (const child of layer.childIds) visit(child);
    };
    visit(id);
    return result;
  }

  getLayerCanvas(id: string): HTMLCanvasElement | null {
    const l = this.byId(id);
    return l?.type === 'text' ? this.textRenderer.get(id) : l?.type === 'raster' ? l.canvas : null;
  }

  getShape(id: string): ShapeParams | null {
    const layer = this.shapeById(id);
    return layer ? { ...layer.shape } : null;
  }

  bumpLayer(id: string): void {
    this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
    this.requestRender();
  }

  private snapshotLayer(
    l: Layer,
    withContent: boolean,
    keepCanvas = false,
  ): LayerSnapshot {
    const snap: LayerSnapshot = {
      id: l.id,
      type: l.type,
      name: l.name,
      opacity: l.opacity,
      blend: l.blend,
      visible: l.visible,
      parentId: l.parentId,
      childIds: [...l.childIds],
    };
    if (l.type === 'adjust') {
      snap.params = { ...l.params };
      snap.maskLayerIds = [...l.maskLayerIds];
    } else if (l.type === 'shape') {
      snap.shape = { ...l.shape };
    } else if (l.type === 'text') {
      snap.text = structuredClone(l.text);
    } else if (withContent) {
      const copy = makeCanvas();
      copy.getContext('2d')!.drawImage(l.canvas, 0, 0);
      snap.canvas = copy;
      if (!keepCanvas) {
        // メモリ節約のため PNG エンコードが済んだら canvas を手放す
        void toBlobP(copy).then((b) => {
          snap.blob = b;
          snap.canvas = undefined;
          this.scheduleStorageRefresh();
        });
      }
    }
    return snap;
  }

  private async restoreLayer(snap: LayerSnapshot, location?: LayerLocation): Promise<void> {
    let layer: Layer;
    if (snap.type === 'raster') {
      const l = createRasterLayer(snap.name, snap.id);
      if (snap.canvas) {
        l.ctx.drawImage(snap.canvas, 0, 0);
      } else if (snap.blob) {
        const bmp = await createImageBitmap(snap.blob);
        l.ctx.drawImage(bmp, 0, 0);
        bmp.close();
      }
      layer = l;
    } else if (snap.type === 'adjust') {
      const l = createAdjustLayer(snap.name, snap.id);
      l.params = { ...(snap.params ?? DEFAULT_ADJUST) };
      l.maskLayerIds = [...(snap.maskLayerIds ?? [])];
      layer = l;
    } else if (snap.type === 'text') {
      layer = createTextLayer(snap.name, snap.text!, snap.id);
    } else {
      layer = createShapeLayer(snap.name, { ...snap.shape! }, snap.id);
    }
    layer.opacity = snap.opacity;
    layer.blend = snap.blend;
    layer.visible = snap.visible;
    layer.parentId = snap.parentId;
    layer.childIds = [...snap.childIds];
    this.layers.push(layer);
    if (location) this.insertAt(layer.id, location);
    this.bumpLayer(layer.id);
  }

  private removeLayerInternal(id: string): void {
    this.detachLayer(id);
    const ids = new Set(this.descendantIds(id));
    this.layers = this.layers.filter((l) => !ids.has(l.id));
  }

  private removeLayerExact(id: string): void {
    this.detachLayer(id);
    this.layers = this.layers.filter((layer) => layer.id !== id);
  }

  private async restoreEntries(entries: LocatedLayerSnapshot[]): Promise<void> {
    const ids = new Set(entries.map((entry) => entry.snapshot.id));
    for (const entry of entries) await this.restoreLayer(entry.snapshot);
    for (const entry of [...entries].sort((a, b) => a.location.index - b.location.index)) {
      if (!entry.location.parentId || !ids.has(entry.location.parentId)) {
        this.insertAt(entry.snapshot.id, entry.location);
      }
    }
  }

  private fixActive(): void {
    if (this.byId(this.activeLayerId)) return;
    const raster = [...this.layers].reverse().find((l) => l.type === 'raster');
    this.activeLayerId = raster?.id ?? this.layers[this.layers.length - 1]?.id ?? '';
  }

  private finishFloating(): void {
    this.finishTextEditing();
    if (this.lasso.phase === 'float') this.lasso.commit();
  }

  /** Ends editing and removes a blank, childless text layer. Returns true when removed. */
  finishTextEditing(): boolean {
    window.dispatchEvent(new Event('rinpaint:text-commit'));
    const id = useStore.getState().textEditingId;
    if (!id) return false;
    useStore.getState().set({ textEditingId: null });
    const layer = this.byId(id);
    // Never discard nested work as a side effect of closing an empty text editor.
    if (layer?.type !== 'text' || layer.childIds.length > 0 || !isEmptyText(layer.text)) return false;
    const location = this.locationOf(id);
    if (!location) return false;
    const snapshots = this.descendantIds(id).map(layerId => this.snapshotLayer(this.byId(layerId)!, true));
    this.removeLayerInternal(id);
    this.history.push({ kind: 'layerRemove', location, snapshots }, '空の文字を削除');
    this.fixActive();
    this.committed();
    return true;
  }
  getText(id: string): TextParams | null {
    const layer = this.byId(id);
    return layer?.type === 'text' ? structuredClone(layer.text) : null;
  }
  updateText(id: string, before: TextParams, after: TextParams, preview = false): void {
    const layer = this.byId(id);
    if (this.busy || layer?.type !== 'text') return;
    layer.text = structuredClone(after);
    this.bumpLayer(id);
    const contentBefore = { ...before, x: 0, y: 0, width: null, height: null };
    const contentAfter = { ...after, x: 0, y: 0, width: null, height: null };
    const frameOnlyPreview = preview && JSON.stringify(contentBefore) === JSON.stringify(contentAfter);
    // During a frame drag, keep the last bitmap and render the final wrap once on
    // pointerup. Text input and formatting still render immediately.
    if (!frameOnlyPreview) this.syncTextRenders();
    if (!preview && JSON.stringify(before) !== JSON.stringify(after)) {
      this.history.push({ kind: 'layerProps', layerId: id, before: { text: structuredClone(before) }, after: { text: structuredClone(after) } }, '文字を編集');
      this.committed();
    } else this.syncStore();
  }
  addTextLayer(text: TextParams): void {
    if (this.busy) return;
    this.finishFloating();
    const parentId = closestRasterOrRoot(this.layers, this.activeLayerId);
    const location = { parentId, index: this.siblingIds(parentId).length };
    const layer = createTextLayer('文字', text);
    this.layers.push(layer);
    this.insertAt(layer.id, location);
    this.activeLayerId = layer.id;
    this.history.push({ kind: 'layerAdd', location, snapshot: this.snapshotLayer(layer, false) }, '文字を追加');
    useStore.getState().set({ textEditingId: layer.id });
    this.committed();
  }
  textAt(x: number, y: number): string | null {
    const walk = (ids: string[]): string | null => {
      for (const id of [...ids].reverse()) {
        const layer = this.byId(id)!;
        const child = walk(layer.childIds);
        if (child) return child;
        if (layer.type !== 'text' || !layer.visible) continue;
        const canvas = this.textRenderer.get(id);
        const w = layer.text.width ?? Math.max(24, Number(canvas?.dataset.textWidth ?? 100));
        const h = layer.text.height ?? Math.max(24, Number(canvas?.dataset.textHeight ?? 60));
        const cx = layer.text.x + w / 2, cy = layer.text.y + h / 2, angle = -(layer.text.rotation ?? 0);
        const dx = x - cx, dy = y - cy;
        const localX = dx * Math.cos(angle) - dy * Math.sin(angle) + cx;
        const localY = dx * Math.sin(angle) + dy * Math.cos(angle) + cy;
        if (localX >= layer.text.x && localY >= layer.text.y && localX <= layer.text.x + w && localY <= layer.text.y + h) return id;
      }
      return null;
    };
    return walk(this.rootLayerIds);
  }
  editTextLayer(id: string): void {
    if (this.busy || this.byId(id)?.type !== 'text') return;
    this.setActiveLayer(id);
    useStore.getState().set({ textEditingId: id });
  }
  async addFont(file: File): Promise<ProjectFont | null> {
    if (this.busy) return null;
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
    this.textRenderer.clear();
    this.committed();
    return font;
  }

  addRasterLayer(): void {
    if (this.busy) return;
    this.finishFloating();
    const activeLocation = this.locationOf(this.activeLayerId);
    const location = activeLocation
      ? { ...activeLocation, index: activeLocation.index + 1 }
      : { parentId: null, index: this.rootLayerIds.length };
    const layer = createRasterLayer(`レイヤー ${++this.layerCounter}`);
    this.layers.push(layer);
    this.insertAt(layer.id, location);
    this.activeLayerId = layer.id;
    this.history.push(
      { kind: 'layerAdd', location, snapshot: this.snapshotLayer(layer, false) },
      'レイヤー追加',
    );
    this.committed();
  }

  addAdjustLayer(): void {
    if (this.busy) return;
    this.finishFloating();
    const activeLocation = this.locationOf(this.activeLayerId);
    const location = activeLocation
      ? { ...activeLocation, index: activeLocation.index + 1 }
      : { parentId: null, index: this.rootLayerIds.length };
    const layer = createAdjustLayer(`色調補正 ${++this.adjustCounter}`);
    this.layers.push(layer);
    this.insertAt(layer.id, location);
    this.activeLayerId = layer.id;
    this.history.push(
      { kind: 'layerAdd', location, snapshot: this.snapshotLayer(layer, false) },
      '補正レイヤー追加',
    );
    this.committed();
  }

  addShapeLayer(shape: ShapeParams): void {
    if (this.busy) return;
    const parentId = closestRasterOrRoot(this.layers, this.activeLayerId);
    const siblings = this.siblingIds(parentId);
    const location: LayerLocation = { parentId, index: siblings.length };
    const names = { line: '直線', rect: '四角形', ellipse: '楕円' } as const;
    const layer = createShapeLayer(names[shape.kind], shape);
    this.layers.push(layer);
    this.insertAt(layer.id, location);
    this.activeLayerId = layer.id;
    this.history.push({ kind: 'layerAdd', location, snapshot: this.snapshotLayer(layer, false) }, '図形を追加');
    useStore.getState().pushColor(shape.color);
    this.committed();
  }

  layerChildren(id: string): string[] {
    return [...(this.byId(id)?.childIds ?? [])];
  }

  layerRootIds(): string[] {
    return [...this.rootLayerIds];
  }

  canMoveLayer(id: string, parentId: string | null): boolean {
    return canReparent(this.layers, id, parentId);
  }

  moveLayerAsTopChild(id: string, parentId: string): void {
    const parent = this.byId(parentId);
    if (parent && this.canMoveLayer(id, parentId)) this.moveLayer(id, { parentId, index: parent.childIds.length });
  }

  moveLayerOut(id: string): void {
    const layer = this.byId(id);
    if (!layer?.parentId) return;
    const parentLocation = this.locationOf(layer.parentId);
    if (parentLocation) this.moveLayer(id, { parentId: parentLocation.parentId, index: parentLocation.index + 1 });
  }

  removeLayer(id: string): void {
    if (this.busy) return;
    this.finishFloating();
    const location = this.locationOf(id);
    if (!location) return;
    const ids = this.descendantIds(id);
    const removeIds = new Set(ids);
    const rasterCount = this.layers.filter((l) => l.type === 'raster').length;
    const removedRasterCount = this.layers.filter((l) => removeIds.has(l.id) && l.type === 'raster').length;
    if (rasterCount - removedRasterCount < 1) return;
    const snapshots = ids.map((layerId) => this.snapshotLayer(this.byId(layerId)!, true));
    const maskOps = this.layers.flatMap(layer => {
      if (layer.type !== 'adjust' || removeIds.has(layer.id) || !layer.maskLayerIds.some(maskId => removeIds.has(maskId))) return [];
      const after = layer.maskLayerIds.filter(maskId => !removeIds.has(maskId));
      const op = { kind: 'layerProps' as const, layerId: layer.id, before: { maskLayerIds: [...layer.maskLayerIds] }, after: { maskLayerIds: after } };
      layer.maskLayerIds = after;
      return [op];
    });
    this.removeLayerInternal(id);
    const removeOp = { kind: 'layerRemove' as const, location, snapshots };
    this.history.push(maskOps.length ? { kind: 'batch', ops: [removeOp, ...maskOps] } : removeOp, 'レイヤー削除');
    this.fixActive();
    this.committed();
  }

  canRemoveLayer(id: string): boolean {
    if (!this.byId(id)) return false;
    const removed = new Set(this.descendantIds(id));
    return this.layers.some(l => l.type === 'raster' && !removed.has(l.id));
  }

  moveLayer(id: string, to: LayerLocation): boolean {
    if (this.busy) return false;
    const from = this.locationOf(id);
    if (!from || !canReparent(this.layers, id, to.parentId)) return false;
    const adjusted = { ...to };
    if (from.parentId === to.parentId && from.index < to.index) adjusted.index--;
    if (from.parentId === adjusted.parentId && from.index === adjusted.index) return false;
    this.detachLayer(id);
    this.insertAt(id, adjusted);
    this.history.push({ kind: 'layerMove', layerId: id, from, to: adjusted }, 'レイヤー並べ替え');
    this.committed();
    return true;
  }

  private stableLayerEntries(
    layers: Layer[],
  ): LocatedLayerSnapshot[] {
    return layers.map((layer) => ({
      location: this.locationOf(layer.id)!,
      snapshot: this.snapshotLayer(layer, layer.type === 'raster', true),
    }));
  }

  private ownsMergeCompaction(
    owner: HistoryTree,
    node: HistoryNode,
    op: LegacyLayerMergeOp,
    generation: number,
  ): boolean {
    return this.history === owner && this.projectGeneration === generation && node.op === op;
  }

  private historyContains(history: HistoryTree, target: HistoryNode): boolean {
    const visit = (node: HistoryNode): boolean =>
      node === target || node.children.some(visit);
    return visit(history.root);
  }

  private async snapshotWithBlob(snapshot: LayerSnapshot): Promise<LayerSnapshot> {
    const { canvas, ...rest } = snapshot;
    return {
      ...rest,
      blob: snapshot.blob ?? (canvas ? await toBlobP(canvas) : undefined),
    };
  }

  private async compressLegacyMergeFallback(
    owner: HistoryTree,
    node: HistoryNode,
    op: LegacyLayerMergeOp,
    generation: number,
  ): Promise<void> {
    const snapshots = [...op.before, ...op.after]
      .map((entry) => entry.snapshot)
      .filter((snapshot) => snapshot.canvas);
    const encoded = await Promise.all(
      snapshots.map(async (snapshot) => {
        try { return { snapshot, blob: await toBlobP(snapshot.canvas!) }; }
        catch { return null; }
      }),
    );
    if (!this.ownsMergeCompaction(owner, node, op, generation) || !this.historyContains(owner, node)) return;
    let changed = false;
    for (const result of encoded) {
      if (!result) continue;
      result.snapshot.blob = result.blob;
      result.snapshot.canvas = undefined;
      changed = true;
    }
    if (changed) {
      this.scheduleSave();
      this.scheduleStorageRefresh();
    }
  }

  private startMergeCompaction(
    node: HistoryNode,
    op: LegacyLayerMergeOp,
    targetLayerId: string,
    removedLayerId: string,
  ): void {
    const owner = this.history;
    const generation = this.projectGeneration;
    const beforeTarget = op.before.find((entry) => entry.snapshot.id === targetLayerId);
    const afterTarget = op.after.find((entry) => entry.snapshot.id === targetLayerId);
    const removed = op.before.find((entry) => entry.snapshot.id === removedLayerId);
    const beforeCanvas = beforeTarget?.snapshot.canvas;
    const afterCanvas = afterTarget?.snapshot.canvas;
    if (!beforeCanvas || !afterCanvas || !removed) return;

    let cancelled = false;
    const stillCurrent = () => !cancelled && this.ownsMergeCompaction(owner, node, op, generation);
    const task = (async () => {
      try {
        const [tiles, removedSnapshot] = await Promise.all([
          extractTilesBatched(
            beforeCanvas.getContext('2d', { willReadFrequently: true })!,
            afterCanvas.getContext('2d', { willReadFrequently: true })!,
            { minX: 0, minY: 0, maxX: beforeCanvas.width, maxY: beforeCanvas.height },
            beforeCanvas.width,
            beforeCanvas.height,
            stillCurrent,
          ),
          this.snapshotWithBlob(removed.snapshot),
        ]);
        if (!stillCurrent() || !this.historyContains(owner, node)) return;
        const compact: TileLayerMergeOp = {
          kind: 'layerMerge',
          format: 'tiles-v1',
          targetLayerId,
          removed: {
            location: { ...removed.location },
            snapshot: removedSnapshot,
          },
          tiles,
          beforeActiveId: op.beforeActiveId,
          afterActiveId: op.afterActiveId,
          maskChanges: op.maskChanges?.map(change => ({ ...change, before: [...change.before], after: [...change.after] })),
        };
        node.op = compact;
        this.scheduleSave();
        this.scheduleStorageRefresh();
      } catch {
        const mayFallback = stillCurrent();
        cancelled = true;
        if (mayFallback) {
          await this.compressLegacyMergeFallback(owner, node, op, generation);
        }
      }
    })();
    this.mergeCompactions.add(task);
    void task.finally(() => this.mergeCompactions.delete(task));
  }

  private mergeTarget(layer: Layer): RasterLayer | null {
    const targetId = structuralLowerId(layer, this.rootLayerIds, this.layers);
    return targetId ? this.rasterById(targetId) : null;
  }

  canMergeLayerDown(id = this.activeLayerId): boolean {
    const layer = this.byId(id);
    return !!layer && !!this.mergeTarget(layer);
  }

  canTransferShape(id = this.activeLayerId): boolean {
    const layer = this.shapeById(id);
    return !!layer && layer.childIds.length === 0 && !!layer.parentId && !!this.rasterById(layer.parentId);
  }

  private bakeLayerOnto(target: RasterLayer, source: Layer): void {
    if (source.type === 'adjust') {
      this.tmpCtx.save();
      this.tmpCtx.clearRect(0, 0, ART_W, ART_H);
      this.tmpCtx.filter = buildFilter(source.params);
      this.tmpCtx.drawImage(target.canvas, 0, 0);
      this.tmpCtx.restore();
      target.ctx.save();
      target.ctx.globalAlpha = source.opacity;
      target.ctx.globalCompositeOperation = 'source-over';
      target.ctx.drawImage(this.tmp, 0, 0);
      target.ctx.restore();
    } else {
      target.ctx.save();
      target.ctx.globalAlpha = source.opacity;
      target.ctx.globalCompositeOperation = source.blend;
      if (source.type === 'raster') target.ctx.drawImage(source.canvas, 0, 0);
      else if (source.type === 'text') this.textRenderer.draw(target.ctx, source.id, source.text);
      else drawShape(target.ctx, source.shape);
      target.ctx.restore();
    }
  }

  /** 選択中の葉レイヤーを、構造上の直下のラスターへ統合する。 */
  async mergeLayerDown(id = this.activeLayerId): Promise<void> {
    if (this.busy) return;
    this.finishFloating();
    const upper = this.byId(id);
    if (!upper) return;
    const lower = this.mergeTarget(upper);
    if (!lower) return;

    this.busy = true;
    try {
      await this.readyToRender();
      const beforeActiveId = this.activeLayerId;
      const before = this.stableLayerEntries([lower, upper]);
      const maskChanges = this.detachMaskReferences(new Set(this.descendantIds(upper.id)));
      this.bakeLayerOnto(lower, upper);
      this.removeLayerInternal(upper.id);
      this.activeLayerId = lower.id;
      this.bumpLayer(lower.id);
      const after = this.stableLayerEntries([lower]);
      const op: LegacyLayerMergeOp = {
        kind: 'layerMerge',
        format: 'snapshots-v1',
        before,
        after,
        beforeActiveId,
        afterActiveId: lower.id,
        maskChanges,
      };
      const node = this.history.push(op, '下のレイヤーと統合');
      this.startMergeCompaction(node, op, lower.id, upper.id);
    } finally { this.busy = false; }
    this.committed();
  }

  transferShapeLayer(): void {
    if (this.busy) return;
    if (!this.canTransferShape()) return;
    const shape = this.shapeById(this.activeLayerId)!;
    const parent = this.rasterById(shape.parentId!)!;
    const beforeActiveId = shape.id;
    const before = this.stableLayerEntries([parent, shape]);
    const maskChanges = this.detachMaskReferences(new Set(this.descendantIds(shape.id)));
    this.bakeLayerOnto(parent, shape);
    this.removeLayerInternal(shape.id);
    this.activeLayerId = parent.id;
    this.bumpLayer(parent.id);
    const after = this.stableLayerEntries([parent]);
    const op: LegacyLayerMergeOp = {
      kind: 'layerMerge',
      format: 'snapshots-v1',
      before,
      after,
      beforeActiveId,
      afterActiveId: parent.id,
      maskChanges,
    };
    const node = this.history.push(op, '図形を転写');
    this.startMergeCompaction(node, op, parent.id, shape.id);
    this.committed();
  }

  private detachMaskReferences(removedIds: Set<string>): { layerId: string; before: string[]; after: string[] }[] {
    return this.layers.flatMap(layer => {
      if (layer.type !== 'adjust' || removedIds.has(layer.id) || !layer.maskLayerIds.some(id => removedIds.has(id))) return [];
      const before = [...layer.maskLayerIds], after = before.filter(id => !removedIds.has(id));
      layer.maskLayerIds = after;
      return [{ layerId: layer.id, before, after }];
    });
  }

  setActiveLayer(id: string): void {
    if (this.busy || !this.byId(id)) return;
    const state = useStore.getState();
    if (state.multiSelectMode) {
      const selected = new Set(state.selectedLayerIds);
      const removing = selected.has(id);
      if (removing) selected.delete(id); else selected.add(id);
      if (selected.size === 0) selected.add(id);
      this.activeLayerId = removing ? [...selected].at(-1)! : id;
      state.set({ selectedLayerIds: [...selected] });
      this.syncStore();
      return;
    }
    if (id === this.activeLayerId) return;
    this.finishFloating();
    this.activeLayerId = id;
    this.requestRender();
    this.syncStore();
    this.scheduleSave();
  }

  private assignProps(l: Layer, p: LayerProps): void {
    if (p.name !== undefined) l.name = p.name;
    if (p.opacity !== undefined) l.opacity = p.opacity;
    if (p.blend !== undefined) l.blend = p.blend;
    if (p.visible !== undefined) l.visible = p.visible;
    if (p.params !== undefined && l.type === 'adjust') l.params = { ...p.params };
    if (p.maskLayerIds !== undefined && l.type === 'adjust') l.maskLayerIds = [...p.maskLayerIds];
    if (p.shape !== undefined && l.type === 'shape') l.shape = { ...p.shape };
    if (p.text !== undefined && l.type === 'text') l.text = structuredClone(p.text);
  }

  /** スライダードラッグ中のライブ反映 (履歴は積まない) */
  previewLayerProps(id: string, props: LayerProps): void {
    if (this.busy) return;
    const l = this.byId(id);
    if (!l) return;
    this.assignProps(l, props);
    this.requestRender();
    this.syncStore();
  }

  /** 値の確定 (before → after を1つの履歴ノードとして積む) */
  commitLayerProps(id: string, before: LayerProps, after: LayerProps, label: string): void {
    if (this.busy) return;
    window.dispatchEvent(new Event('rinpaint:text-commit'));
    const l = this.byId(id);
    if (!l) return;
    this.assignProps(l, after);
    this.history.push({ kind: 'layerProps', layerId: id, before, after }, label);
    this.committed();
  }

  updateShapeParams(id: string, before: ShapeParams, after: ShapeParams, preview = false): void {
    if (preview) this.previewLayerProps(id, { shape: after });
    else this.commitLayerProps(id, { shape: before }, { shape: after }, '図形を編集');
  }

  beginShapeEdit(point: StrokePoint, _event?: PointerEvent): boolean {
    const layer = this.shapeById(this.activeLayerId);
    if (!layer) return false;
    const shape = layer.shape;
    const radius = 11 * this.uiScale();
    const near = (x: number, y: number) => Math.hypot(point.x - x, point.y - y) <= radius;
    let mode: ShapeEdit['mode'] | null = null;
    const center = shapeCenter(shape);
    const bounds = shapeBounds(shape);
    if (near(center.x, bounds.y - 28 * this.uiScale())) mode = 'rotate';
    if (!mode && shape.kind === 'line') {
      if (near(shape.x1, shape.y1)) mode = 'start';
      else if (near(shape.x2, shape.y2)) mode = 'end';
    } else if (!mode && shape.kind !== 'line') {
      const points = shapeCorners(shape);
      const corners = [['nw', points[0].x, points[0].y], ['ne', points[1].x, points[1].y], ['se', points[2].x, points[2].y], ['sw', points[3].x, points[3].y]] as const;
      mode = corners.find(([, x, y]) => near(x, y))?.[0] ?? null;
    }
    const b = shapeBounds(shape);
    const inside = point.x >= b.x - radius && point.x <= b.x + b.w + radius && point.y >= b.y - radius && point.y <= b.y + b.h + radius;
    if (!mode && inside) mode = 'move';
    if (!mode) return false;
    this.shapeEdit = { layerId: layer.id, mode, start: point, before: { ...shape } };
    return true;
  }

  updateShapeEdit(point: StrokePoint, _event?: PointerEvent): boolean {
    const edit = this.shapeEdit;
    if (!edit) return false;
    const layer = this.shapeById(edit.layerId);
    if (!layer) return false;
    const dx = point.x - edit.start.x;
    const dy = point.y - edit.start.y;
    let next: ShapeParams = { ...edit.before };
    if (edit.mode === 'move') next = translateShape(edit.before, dx, dy);
    else if (edit.mode === 'rotate') {
      const center = shapeCenter(edit.before);
      const initial = Math.atan2(edit.start.y - center.y, edit.start.x - center.x);
      next = rotateShape(edit.before, Math.atan2(point.y - center.y, point.x - center.x) - initial);
    }
    else if (edit.before.kind === 'line') {
      next = edit.mode === 'start'
        ? { ...edit.before, x1: point.x, y1: point.y }
        : { ...edit.before, x2: point.x, y2: point.y };
    } else {
      const center = shapeCenter(edit.before);
      const angle = edit.before.rotation ?? 0, cos = Math.cos(-angle), sin = Math.sin(-angle);
      const px = (point.x - center.x) * cos - (point.y - center.y) * sin;
      const py = (point.x - center.x) * sin + (point.y - center.y) * cos;
      const hw = edit.before.kind === 'rect' ? edit.before.width / 2 : edit.before.rx;
      const hh = edit.before.kind === 'rect' ? edit.before.height / 2 : edit.before.ry;
      const left = edit.mode.endsWith('w') ? px : -hw, right = edit.mode.endsWith('e') ? px : hw;
      const top = edit.mode.startsWith('n') ? py : -hh, bottom = edit.mode.startsWith('s') ? py : hh;
      const localX = (left + right) / 2, localY = (top + bottom) / 2;
      const worldX = center.x + localX * Math.cos(angle) - localY * Math.sin(angle);
      const worldY = center.y + localX * Math.sin(angle) + localY * Math.cos(angle);
      const w = Math.max(.01, Math.abs(right - left)), h = Math.max(.01, Math.abs(bottom - top));
      next = edit.before.kind === 'rect'
        ? { ...edit.before, x: worldX - w / 2, y: worldY - h / 2, width: w, height: h }
        : { ...edit.before, cx: worldX, cy: worldY, rx: w / 2, ry: h / 2 };
    }
    layer.shape = next;
    this.requestRender();
    this.syncStore();
    return true;
  }

  finishShapeEdit(_point: StrokePoint): boolean {
    const edit = this.shapeEdit;
    if (!edit) return false;
    this.shapeEdit = null;
    const layer = this.shapeById(edit.layerId);
    if (layer && JSON.stringify(layer.shape) !== JSON.stringify(edit.before)) {
      this.history.push({ kind: 'layerProps', layerId: layer.id, before: { shape: edit.before }, after: { shape: { ...layer.shape } } }, '図形を編集');
      this.committed();
    }
    return true;
  }

  cancelShapeEdit(): void {
    const edit = this.shapeEdit;
    if (!edit) return;
    const layer = this.shapeById(edit.layerId);
    if (layer) layer.shape = edit.before;
    this.shapeEdit = null;
    this.requestRender();
    this.syncStore();
  }

  drawActiveShapeHandles(ctx: CanvasRenderingContext2D): void {
    const layer = this.shapeById(this.activeLayerId);
    if (!layer) return;
    const shape = layer.shape;
    const b = shapeBounds(shape);
    const points = shape.kind === 'line'
      ? [[shape.x1, shape.y1], [shape.x2, shape.y2]]
      : shapeCorners(shape).map(point => [point.x, point.y]);
    const scale = this.uiScale();
    const center = shapeCenter(shape);
    const rotateHandle = { x: center.x, y: b.y - 28 * scale };
    ctx.save();
    ctx.strokeStyle = '#4f8cff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 1.5 * scale;
    ctx.setLineDash([4 * scale, 3 * scale]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    for (const [x, y] of points) {
      ctx.beginPath();
      ctx.rect(x - 4 * scale, y - 4 * scale, 8 * scale, 8 * scale);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(center.x, b.y); ctx.lineTo(rotateHandle.x, rotateHandle.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(rotateHandle.x, rotateHandle.y, 5 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- tools / misc

  /** ツールインスタンスを切り替える (記憶された色・太さも反映される) */
  selectToolInstance(id: string): void {
    if (this.busy) return;
    const st = useStore.getState();
    const inst = st.tools.find((t) => t.id === id);
    if (!inst) return;
    if (id === st.activeToolId) {
      this.finishFloating();
      this.lasso.cancel();
      st.deactivateTool();
      this.requestRender();
      this.scheduleSave();
      return;
    }
    if (inst.kind !== st.tool) {
      this.finishFloating();
      this.lasso.cancel();
    }
    st.activateTool(id);
    this.requestRender();
    this.syncStore();
  }

  addToolInstance(kind: ToolKind): void {
    if (this.busy) return;
    const st = useStore.getState();
    if (kind !== st.tool) {
      this.finishFloating();
      this.lasso.cancel();
    }
    st.addTool(kind);
    this.requestRender();
    this.syncStore();
  }

  removeToolInstance(id: string): void {
    if (this.busy) return;
    const st = useStore.getState();
    if (id === st.activeToolId) {
      this.finishFloating();
      this.lasso.cancel();
    }
    st.removeTool(id);
    this.requestRender();
    this.syncStore();
  }

  reorderToolInstance(from: number, to: number): void {
    if (this.busy) return;
    useStore.getState().reorderTools(from, to);
    this.scheduleSave();
  }

  renameToolInstance(id: string, name: string): boolean {
    const clean = name.trim();
    if (!clean) return false;
    useStore.getState().renameTool(id, clean);
    this.scheduleSave();
    return true;
  }

  renameLayer(id: string, name: string): boolean {
    const layer = this.byId(id);
    const clean = name.trim();
    if (!layer || !clean || layer.name === clean) return false;
    this.commitLayerProps(id, { name: layer.name }, { name: clean }, 'レイヤー名を変更');
    return true;
  }

  beginMultiSelect(id: string): void {
    if (!this.byId(id)) return;
    const st = useStore.getState();
    const selected = new Set(st.selectedLayerIds.length ? st.selectedLayerIds : [this.activeLayerId]);
    selected.add(id);
    this.activeLayerId = id;
    if (st.tool !== 'lasso') st.deactivateTool();
    st.set({ multiSelectMode: true, selectedLayerIds: [...selected] });
    this.syncStore();
  }

  exitMultiSelect(): void {
    const st = useStore.getState();
    st.set({ multiSelectMode: false, selectedLayerIds: this.activeLayerId ? [this.activeLayerId] : [] });
    this.syncStore();
  }

  commitSelectedLayerProps(before: LayerProps, after: LayerProps, label: string): void {
    const st = useStore.getState();
    const ids = st.multiSelectMode ? st.selectedLayerIds : [this.activeLayerId];
    const ops = ids.flatMap(id => {
      const layer = this.byId(id);
      if (!layer) return [];
      const current: LayerProps = {
        opacity: layer.opacity, visible: layer.visible, blend: layer.blend,
        ...(layer.type === 'adjust' ? { params: { ...layer.params }, maskLayerIds: [...layer.maskLayerIds] } : {}),
        ...(layer.type === 'shape' ? { shape: { ...layer.shape } } : {}),
        ...(layer.type === 'text' ? { text: structuredClone(layer.text) } : {}),
      };
      const op = { kind: 'layerProps' as const, layerId: id, before: { ...current, ...before }, after };
      this.assignProps(layer, after);
      return [op];
    });
    if (!ops.length) return;
    this.history.push(ops.length === 1 ? ops[0] : { kind: 'batch', ops }, label);
    this.committed();
  }

  async copyLayers(menuLayerId?: string): Promise<void> {
    const st = useStore.getState();
    let ids = menuLayerId && (!st.multiSelectMode || !st.selectedLayerIds.includes(menuLayerId))
      ? [menuLayerId]
      : st.multiSelectMode ? st.selectedLayerIds : [menuLayerId ?? this.activeLayerId];
    ids = ids.filter(id => !!this.byId(id));
    const chosen = new Set(ids);
    const roots = ids.filter(id => {
      let parent = this.byId(id)?.parentId ?? null;
      while (parent) { if (chosen.has(parent)) return false; parent = this.byId(parent)?.parentId ?? null; }
      return true;
    });
    const allIds = new Set(roots.flatMap(id => this.descendantIds(id)));
    const layers: SavedLayer[] = await Promise.all(this.layers.filter(layer => allIds.has(layer.id)).map(async layer => {
      const snap = this.snapshotLayer(layer, false);
      const saved: SavedLayer = { ...snap };
      if (layer.type === 'raster') saved.blob = await toBlobP(layer.canvas);
      return saved;
    }));
    const clipboard: LayerClipboard = { version: 1, sourcePageId: this.activePageId, sourcePpi: this.canvasSpec.ppi, rootIds: roots, layers };
    await saveClipboard(clipboard);
    useStore.getState().set({ clipboardAvailable: true });
  }

  async pasteLayers(): Promise<void> {
    if (this.busy) return;
    const clipboard = await loadClipboard();
    if (!clipboard?.layers.length) return;
    const factor = this.canvasSpec.ppi / clipboard.sourcePpi;
    const ids = new Map<string, string>(clipboard.layers.map(layer => [layer.id, String(crypto.randomUUID())]));
    const remap = (id: string | null) => id ? ids.get(id) ?? null : null;
    const snapshots: LayerSnapshot[] = [];
    for (const source of clipboard.layers) {
      const snapshot: LayerSnapshot = {
        ...structuredClone({ ...source, blob: undefined }),
        id: ids.get(source.id)!, parentId: remap(source.parentId),
        childIds: source.childIds.map(id => ids.get(id)).filter((id): id is string => typeof id === 'string'),
        maskLayerIds: source.maskLayerIds?.map(id => ids.get(id)).filter((id): id is string => typeof id === 'string'),
      };
      if (source.shape) snapshot.shape = factor === 1 ? { ...source.shape } : scaleShape(source.shape, factor);
      if (source.text) snapshot.text = { ...structuredClone(source.text), x: source.text.x * factor, y: source.text.y * factor, width: source.text.width === null ? null : source.text.width * factor, height: source.text.height === null ? null : source.text.height * factor };
      if (source.blob) {
        const bmp = await createImageBitmap(source.blob);
        const canvas = makeCanvas();
        canvas.getContext('2d')!.drawImage(bmp, 0, 0, bmp.width * factor, bmp.height * factor); bmp.close();
        snapshot.canvas = canvas;
      }
      snapshots.push(snapshot);
    }
    const primaryLocation = this.locationOf(this.activeLayerId) ?? { parentId: null, index: this.rootLayerIds.length - 1 };
    const rootIds = clipboard.rootIds.map(id => ids.get(id)).filter((id): id is string => typeof id === 'string');
    const ops: Extract<Op, { kind: 'batch' }>['ops'] = [];
    const sourceById = new Map(clipboard.layers.map(layer => [layer.id, layer]));
    const sourceIdByNew = new Map([...ids].map(([oldId, newId]) => [newId, oldId]));
    const pending = [...snapshots];
    while (pending.length) {
      const index = pending.findIndex(snapshot => !snapshot.parentId || !!this.byId(snapshot.parentId));
      if (index < 0) break;
      const [snapshot] = pending.splice(index, 1);
      const source = sourceById.get(sourceIdByNew.get(snapshot.id)!)!;
      const isRoot = rootIds.includes(snapshot.id);
      const location = isRoot
        ? { parentId: primaryLocation.parentId, index: primaryLocation.index + 1 + rootIds.indexOf(snapshot.id) }
        : { parentId: snapshot.parentId, index: source.parentId ? sourceById.get(source.parentId)?.childIds.indexOf(source.id) ?? 0 : 0 };
      snapshot.parentId = location.parentId;
      snapshot.childIds = [];
      await this.restoreLayer(snapshot, location);
      ops.push({ kind: 'layerAdd', snapshot, location });
    }
    this.activeLayerId = rootIds.at(-1) ?? this.activeLayerId;
    useStore.getState().set({ multiSelectMode: rootIds.length > 1, selectedLayerIds: rootIds });
    this.history.push({ kind: 'batch', ops }, 'レイヤーをペースト');
    this.committed();
  }

  async addPage(): Promise<void> {
    await this.flushSave();
    const id = this.newPageId();
    const layer = createRasterLayer('レイヤー 1');
    const history = new HistoryTree();
    const page: SavedPage = { id, canvasSpec: { ...this.canvasSpec }, rootLayerIds: [layer.id], activeLayerId: layer.id, layers: [{ ...this.snapshotLayer(layer, false), blob: await toBlobP(layer.canvas) }], history: await history.serialize(toBlobP), view: { x: 0, y: 0, scale: 1, rot: 0 }, thumbnailVersion: 0 };
    const index = Math.max(0, this.pageOrder.indexOf(this.activePageId));
    this.pageOrder.splice(index + 1, 0, id);
    await savePage(page);
    await this.saveMeta();
    this.syncStore();
  }

  async switchPage(id: string): Promise<void> {
    if (this.busy || id === this.activePageId || !this.pageOrder.includes(id)) return;
    this.finishFloating();
    this.exitMultiSelect();
    await this.flushSave();
    await this.recorder.reset();
    this.busy = true; useStore.getState().set({ pageBusy: true });
    try {
      const page = await loadPage(id);
      if (!page) throw new Error('ページを読み込めませんでした');
      this.activePageId = id; setPersistencePageId(id);
      await this.restoreSavedPage(page);
      await this.saveMeta();
      window.dispatchEvent(new Event('rinpaint:project-reset'));
      this.requestRender(); this.syncStore();
    } finally { this.busy = false; useStore.getState().set({ pageBusy: false }); }
  }

  async deletePage(id: string): Promise<void> {
    if (this.pageOrder.length <= 1 || !this.pageOrder.includes(id)) return;
    const index = this.pageOrder.indexOf(id);
    if (id === this.activePageId) {
      const target = this.pageOrder[index + 1] ?? this.pageOrder[index - 1];
      await this.switchPage(target);
    }
    this.pageOrder = this.pageOrder.filter(pageId => pageId !== id);
    await deletePageData(id); await this.saveMeta(); this.syncStore();
  }

  async reorderPages(from: number, to: number): Promise<void> {
    if (from < 0 || to < 0 || from >= this.pageOrder.length || to >= this.pageOrder.length || from === to) return;
    const [id] = this.pageOrder.splice(from, 1); this.pageOrder.splice(to, 0, id);
    await this.saveMeta(); this.syncStore();
  }

  private async saveMeta(): Promise<void> {
    const st = useStore.getState();
    await saveProjectMeta({ version: 4, pageOrder: [...this.pageOrder], activePageId: this.activePageId, fonts: structuredClone(st.fonts), penColor: st.penColor, penSize: st.penSize, colorHistory: [...st.colorHistory], tools: structuredClone(st.tools), toolLayout: structuredClone(st.toolLayout), toolStacks: structuredClone(st.toolStacks), activeToolId: st.activeToolId });
  }

  /** 浮動選択の自由変形モードを切り替える */
  setSelectionFreeTransform(on: boolean): void {
    this.lasso.setFreeTransform(on);
  }

  private canvasSnapshot(): CanvasSnapshot {
    return { spec: { ...this.canvasSpec }, layers: this.layers.map(l => this.snapshotLayer(l, true, true)), roots: [...this.rootLayerIds], activeId: this.activeLayerId };
  }
  private async restoreCanvasSnapshot(snapshot: CanvasSnapshot): Promise<void> {
    this.canvasSpec = { ...snapshot.spec };
    const pixels = canvasPixels(snapshot.spec);
    setArtSize(pixels.width, pixels.height);
    this.layers = [];
    for (const layer of snapshot.layers) await this.restoreLayer(layer);
    this.rootLayerIds = [...snapshot.roots];
    this.activeLayerId = snapshot.activeId;
    this.syncWorkCanvases();
    this.textRenderer.clear();
    this.syncTextRenders();
    useStore.getState().set({ canvasW: ART_W, canvasH: ART_H, canvasSpec: { ...this.canvasSpec } });
  }
  async resizeCanvas(spec: CanvasSpec): Promise<void> {
    if (this.busy) throw new Error('処理の完了後にサイズを変更してください');
    const error = validateCanvasSpec(spec);
    if (error) throw new Error(error);
    if (JSON.stringify(spec) === JSON.stringify(this.canvasSpec)) return;
    this.finishFloating();
    this.lasso.cancelSelection();
    this.busy = true;
    const before = this.canvasSnapshot();
    try {
      const { width, height } = canvasPixels(spec);
      const factor = spec.ppi / this.canvasSpec.ppi;
      // Allocate every replacement before mutating any layer.
      const rasters = new Map<string, HTMLCanvasElement>();
      for (const layer of this.layers) if (layer.type === 'raster') {
        const canvas = makeCanvas(width, height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('キャンバス用のメモリを確保できませんでした');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(layer.canvas, 0, 0, layer.canvas.width * factor, layer.canvas.height * factor);
        rasters.set(layer.id, canvas);
      }
      for (const layer of this.layers) {
        if (layer.type === 'raster') { layer.canvas = rasters.get(layer.id)!; layer.ctx = layer.canvas.getContext('2d', { willReadFrequently: true })!; }
        else if (layer.type === 'shape') layer.shape = scaleShape(layer.shape, factor);
        else if (layer.type === 'text') layer.text = { ...layer.text, x: layer.text.x * factor, y: layer.text.y * factor, width: layer.text.width === null ? null : layer.text.width * factor, height: layer.text.height === null ? null : layer.text.height * factor };
        this.bumpLayer(layer.id);
      }
      this.canvasSpec = { ...spec };
      setArtSize(width, height);
      this.syncWorkCanvases();
      const after = this.canvasSnapshot();
      const node = this.history.push({ kind: 'canvasChange', before, after }, 'キャンバスサイズ・解像度');
      node.ready = Promise.all([...before.layers, ...after.layers].map(async snapshot => {
        if (snapshot.canvas) {
          try { snapshot.blob = await toBlobP(snapshot.canvas); snapshot.canvas = undefined; }
          catch { /* Keep the original canvas so undo remains lossless; persistence can retry. */ }
        }
      })).then(() => undefined);
      useStore.getState().set({ canvasW: width, canvasH: height, canvasSpec: { ...spec } });
      this.textRenderer.clear();
    } catch (error) {
      await this.restoreCanvasSnapshot(before);
      throw error;
    } finally { this.busy = false; }
    this.committed();
  }

  async newProject(): Promise<void> {
    if (this.busy) throw new Error('処理の完了後に新規作成してください');
    this.finishTextEditing();
    this.lasso.cancelSelection();
    this.clearPendingPress();
    this.activeTool().cancel?.();
    this.cancelShapeEdit();
    this.activePointer = null;
    this.busy = true;
    this.projectGeneration++;
    try {
      await this.recorder.reset();
      if (this.saveTimer !== null) { clearTimeout(this.saveTimer); this.saveTimer = null; }
      await this.saving;
      const layer = createRasterLayer('レイヤー 1');
      const st = useStore.getState();
      const history = new HistoryTree();
      const pageId = this.newPageId();
      const fresh: SavedProject = {
        version: 4, pageOrder: [pageId], activePageId: pageId, canvasSpec: { ...this.canvasSpec }, fonts: [],
        rootLayerIds: [layer.id], activeLayerId: layer.id,
        layers: [{ ...this.snapshotLayer(layer, false), blob: await toBlobP(layer.canvas) }],
        tools: structuredClone(st.tools), activeToolId: st.activeToolId, penColor: st.penColor, penSize: st.penSize,
        toolLayout: structuredClone(st.toolLayout), toolStacks: structuredClone(st.toolStacks),
        colorHistory: [...st.colorHistory], history: await history.serialize(toBlobP),
        view: { x: 0, y: 0, scale: 1, rot: 0 },
        thumbnailVersion: 0,
      };
      await replaceProject(fresh);
      this.activePageId = pageId; this.pageOrder = [pageId]; this.thumbnailVersion = 0;
      setPersistencePageId(pageId);
      this.layers = [layer]; this.rootLayerIds = [layer.id]; this.activeLayerId = layer.id;
      this.layerCounter = 1; this.adjustCounter = 0; this.history = history; this.versions.clear();
      this.textRenderer.clear();
      await loadFonts([]);
      this.persistedRevision = this.saveRevision;
      useStore.getState().set({ fonts: [], textEditingId: null, projectGeneration: this.projectGeneration, selectionActive: false, freeTransform: false, selectedLayerIds: [layer.id], multiSelectMode: false, clipboardAvailable: false, pages: [{ id: pageId, thumbnailVersion: 0 }], activePageId: pageId });
      window.dispatchEvent(new Event('rinpaint:project-reset'));
      this.view.reset();
      this.requestRender(); this.syncStore(); this.scheduleStorageRefresh();
    } finally { this.busy = false; }
  }

  lassoCommit(): void {
    this.lasso.commit();
    this.syncStore();
  }

  lassoDuplicate(): void {
    this.lasso.duplicate();
  }

  lassoCancel(): void {
    this.lasso.cancelSelection();
    this.scheduleSave();
  }

  /**
   * 参照画像DOMの画面上の四隅をアート座標へ変換し、現在のレイヤーへ転写する。
   * 参照ウィンドウ自体はエンジン外なので、この呼び出しだけが履歴・動画に残る。
   */
  transferReferenceImage(
    image: CanvasImageSource,
    naturalWidth: number,
    naturalHeight: number,
    corners: {
      topLeft: { x: number; y: number };
      topRight: { x: number; y: number };
      bottomLeft: { x: number; y: number };
      bottomRight: { x: number; y: number };
    },
    opacity: number,
  ): boolean {
    if (this.busy || naturalWidth <= 0 || naturalHeight <= 0) return false;
    this.finishFloating();
    const layer = this.activeRaster();
    if (!layer) return false;
    const p0 = this.view.clientToArt(corners.topLeft.x, corners.topLeft.y);
    const px = this.view.clientToArt(corners.topRight.x, corners.topRight.y);
    const py = this.view.clientToArt(corners.bottomLeft.x, corners.bottomLeft.y);
    const p3 = this.view.clientToArt(corners.bottomRight.x, corners.bottomRight.y);
    this.captureBefore(layer);
    layer.ctx.save();
    layer.ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
    layer.ctx.globalCompositeOperation = 'source-over';
    layer.ctx.setTransform(
      (px.x - p0.x) / naturalWidth,
      (px.y - p0.y) / naturalWidth,
      (py.x - p0.x) / naturalHeight,
      (py.y - p0.y) / naturalHeight,
      p0.x,
      p0.y,
    );
    layer.ctx.drawImage(image, 0, 0, naturalWidth, naturalHeight);
    layer.ctx.restore();
    const xs = [p0.x, px.x, py.x, p3.x];
    const ys = [p0.y, px.y, py.y, p3.y];
    this.commitRasterEdit(
      layer,
      {
        minX: Math.min(...xs) - 2,
        minY: Math.min(...ys) - 2,
        maxX: Math.max(...xs) + 2,
        maxY: Math.max(...ys) + 2,
      },
      '画像を転写',
    );
    return true;
  }

  async exportPNG(): Promise<void> {
    if (!this.main) return;
    this.finishTextEditing();
    await this.readyToRender();
    downloadBlob(await pngWithPpi(await toBlobP(this.main), this.canvasSpec.ppi), 'rin-paint.png');
  }

  // ---------------------------------------------------------------- project file

  async exportProject(): Promise<void> {
    if (this.busy) throw new Error('処理の完了後に保存してください');
    this.finishFloating();
    this.scheduleSave(); await this.flushSave();
    const meta = await loadProjectMeta();
    if (!meta) throw new Error('プロジェクトを保存できませんでした');
    const pages = (await Promise.all(meta.pageOrder.map(loadPage))).filter((page): page is SavedPage => !!page);
    if (pages.length !== meta.pageOrder.length) throw new Error('一部のページを読み込めませんでした');
    downloadBlob(await packProjectFile({ app: 'rin-paint', version: 4, meta, pages }), `rin-paint-${new Date().toISOString().slice(0, 10)}.rinpaint`);
  }

  /** プロジェクトファイルを読み込み、現在の内容と履歴を置き換える */
  async importProject(file: File): Promise<void> {
    if (this.busy) throw new Error('busy');
    const archive = await unpackProjectFile(file);
    const proj = archive.pages.find(page => page.id === archive.meta.activePageId) ?? archive.pages[0];
    if (this.busy) throw new Error('busy');
    this.finishFloating();
    this.lasso.cancelSelection();
    const before = this.canvasSnapshot();
    const previousFonts = useStore.getState().fonts;
    const previousHistory = this.history;
    this.busy = true;
    this.projectGeneration++;
    try {
      await this.recorder.reset();
      if (this.saveTimer !== null) { clearTimeout(this.saveTimer); this.saveTimer = null; }
      await this.saving;
      const saved: SavedProject = { ...archive.meta, activePageId: proj.id, pageOrder: archive.pages.map(page => page.id), ...proj, pages: archive.pages };
      await replaceProject(saved);
      this.pageOrder = [...saved.pageOrder]; this.activePageId = saved.activePageId; setPersistencePageId(this.activePageId);
      this.canvasSpec = { ...proj.canvasSpec };
      const pixels = canvasPixels(this.canvasSpec);
      setArtSize(pixels.width, pixels.height);
      await loadFonts(archive.meta.fonts);
      useStore.getState().set({ fonts: archive.meta.fonts });
      this.textRenderer.clear();
      this.syncWorkCanvases();
      const layers: Layer[] = [];
      let rasterCount = 0;
      let adjustCount = 0;
      for (const pl of proj.layers) {
        if (pl.type === 'adjust') {
          const l = createAdjustLayer(pl.name ?? `色調補正 ${++adjustCount}`, pl.id);
          l.params = { ...DEFAULT_ADJUST, ...(pl.params ?? {}) };
          l.maskLayerIds = [...(pl.maskLayerIds ?? [])];
          l.opacity = pl.opacity ?? 1;
          l.blend = pl.blend ?? 'source-over';
          l.visible = pl.visible ?? true;
          l.parentId = pl.parentId;
          l.childIds = [...pl.childIds];
          layers.push(l);
        } else if (pl.type === 'raster') {
          const l = createRasterLayer(pl.name ?? `レイヤー ${++rasterCount}`, pl.id);
          l.opacity = pl.opacity ?? 1;
          l.blend = pl.blend ?? 'source-over';
          l.visible = pl.visible ?? true;
          l.parentId = pl.parentId;
          l.childIds = [...pl.childIds];
          if (pl.blob) {
            const bmp = await createImageBitmap(pl.blob);
            l.ctx.drawImage(bmp, 0, 0);
            bmp.close();
          }
          layers.push(l);
        } else if (pl.type === 'text' && pl.text) {
          const l = createTextLayer(pl.name, pl.text, pl.id);
          Object.assign(l, { opacity: pl.opacity, blend: pl.blend, visible: pl.visible, parentId: pl.parentId, childIds: [...pl.childIds] });
          layers.push(l);
        } else if (pl.shape) {
          const l = createShapeLayer(pl.name, { ...pl.shape }, pl.id);
          l.opacity = pl.opacity;
          l.blend = pl.blend;
          l.visible = pl.visible;
          l.parentId = pl.parentId;
          l.childIds = [...pl.childIds];
          layers.push(l);
        }
      }
      if (!layers.some((l) => l.type === 'raster')) {
        const fallback = createRasterLayer('レイヤー 1');
        layers.push(fallback);
        proj.rootLayerIds.push(fallback.id);
      }
      if (!validateLayerTree(proj.rootLayerIds, layers)) throw new Error('invalid layer tree');
      this.layers = layers;
      this.rootLayerIds = [...proj.rootLayerIds];
      this.activeLayerId = proj.activeLayerId ?? '';
      this.layerCounter = layers.filter((l) => l.type === 'raster').length;
      this.adjustCounter = layers.filter((l) => l.type === 'adjust').length;
      this.history = new HistoryTree();
      this.history.restore(proj.history);
      for (const l of layers) this.bumpLayer(l.id);
      useStore.getState().set({
        penColor: archive.meta.penColor,
        penSize: archive.meta.penSize,
        colorHistory: Array.isArray(archive.meta.colorHistory)
          ? archive.meta.colorHistory
          : useStore.getState().colorHistory,
        canvasW: ART_W,
        canvasH: ART_H,
        canvasSpec: { ...this.canvasSpec },
        clipboardAvailable: false,
        activePageId: this.activePageId,
        pages: this.pageOrder.map(id => ({ id, thumbnailVersion: archive.pages.find(page => page.id === id)?.thumbnailVersion ?? 0 })),
      });
      this.restoreTools(archive.meta.tools, archive.meta.activeToolId, archive.meta.toolLayout, archive.meta.toolStacks);
      this.fixActive();
      this.syncTextRenders();
    } catch (error) {
      await loadFonts(previousFonts);
      useStore.getState().set({ fonts: previousFonts });
      await this.restoreCanvasSnapshot(before);
      this.history = previousHistory;
      this.syncStore();
      throw error;
    } finally {
      this.busy = false;
    }
    this.requestRender();
    this.syncStore();
    this.scheduleSave();
  }

  // ---------------------------------------------------------------- store sync

  syncStore(): void {
    const metas: LayerMeta[] = this.layers.map((l) => ({
      id: l.id,
      type: l.type,
      name: l.name,
      opacity: l.opacity,
      blend: l.blend,
      visible: l.visible,
      parentId: l.parentId,
      childIds: [...l.childIds],
      params: l.type === 'adjust' ? { ...l.params } : undefined,
      maskLayerIds: l.type === 'adjust' ? [...l.maskLayerIds] : undefined,
      shape: l.type === 'shape' ? { ...l.shape } : undefined,
      text: l.type === 'text' ? structuredClone(l.text) : undefined,
      version: this.versions.get(l.id) ?? 0,
    }));
    const state = useStore.getState();
    const selectedLayerIds = state.multiSelectMode
      ? state.selectedLayerIds.filter(id => this.byId(id))
      : [this.activeLayerId].filter(Boolean);
    useStore.getState().set({
      layers: metas,
      activeLayerId: this.activeLayerId,
      selectedLayerIds,
      pages: this.pageOrder.map(id => ({ id, thumbnailVersion: id === this.activePageId ? this.thumbnailVersion : state.pages.find(page => page.id === id)?.thumbnailVersion ?? 0 })),
      activePageId: this.activePageId,
      canUndo: this.history.canUndo(),
      canRedo: this.history.canRedo(),
      redoBranches: this.history.current.children.map((c, i) => ({
        index: i,
        label: c.label,
      })),
      historyCount: this.history.nodeCount(),
      historyPrunableCount: this.history.prunableCount(10),
      selectionActive: this.lasso.phase === 'float',
      freeTransform: this.lasso.phase === 'float' && this.lasso.free,
    });
  }

  // ---------------------------------------------------------------- persistence

  scheduleSave(): void {
    if (!this.initialized) return;
    this.saveRevision++;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flushSave();
    }, 200);
  }

  /** 保存要求を順番に処理し、古い非同期保存が新しい状態を上書きしないようにする。 */
  private flushSave(): Promise<void> {
    if (!this.initialized) return Promise.resolve();
    if (this.busy) return this.saving ?? Promise.resolve();
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    // 選択範囲は元レイヤーから一時的に切り抜かれているため、その途中像は保存しない。
    // 確定・キャンセル時の committed()、または pagehide の確定後に改めて保存される。
    if (this.lasso.phase !== 'idle') return Promise.resolve();
    if (this.saving) return this.saving;
    let failed = false;
    this.saving = (async () => {
      while (this.persistedRevision < this.saveRevision) {
        const targetRevision = this.saveRevision;
        try {
          await this.saveSnapshot();
          this.persistedRevision = targetRevision;
        } catch {
          // 次の変更・pagehide で再試行する。失敗時に無限再試行はしない。
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

  private async saveSnapshot(): Promise<void> {
    const st = useStore.getState();
    // Canvas は後続の描画で変わるため、状態を採取する時点で同期コピーする。
    const layerSources = this.layers.map((l) => {
      if (l.type === 'text') return { ...this.snapshotLayer(l, false), type: 'text' as const };
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
      const canvas = makeCanvas();
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
    const activeLayerId = this.activeLayerId;
    const view = this.view.snapshot();
    const canvasSpec = { ...this.canvasSpec };
    const fonts = structuredClone(st.fonts);
    const rootLayerIds = [...this.rootLayerIds];
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
    const historyPromise = this.history.serialize(toBlobP);
    const layers: SavedLayer[] = await Promise.all(
      layerSources.map(async (l) => {
        if (l.type !== 'raster') return l;
        const { canvas, ...meta } = l;
        return { ...meta, blob: await toBlobP(canvas) };
      }),
    );
    let thumbnail: Blob | undefined;
    if (this.main) {
      this.ensureComposited();
      const thumb = document.createElement('canvas');
      thumb.width = 240; thumb.height = Math.max(1, Math.round(240 * ART_H / ART_W));
      thumb.getContext('2d')!.drawImage(this.main, 0, 0, thumb.width, thumb.height);
      thumbnail = await new Promise(resolve => thumb.toBlob(blob => resolve(blob ?? undefined), 'image/webp', .72));
      this.thumbnailVersion++;
    }
    await saveProject({
      version: 4,
      pageOrder: [...this.pageOrder],
      activePageId: this.activePageId,
      canvasSpec,
      fonts,
      rootLayerIds,
      layers,
      activeLayerId,
      penColor,
      penSize,
      colorHistory,
      tools,
      toolLayout,
      toolStacks,
      activeToolId,
      history: await historyPromise,
      view,
      thumbnailVersion: this.thumbnailVersion,
      thumbnail,
    });
    this.scheduleStorageRefresh();
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      window.dispatchEvent(new Event('rinpaint:text-commit'));
      void this.flushSave();
    }
  };

  private onPageHide = (event: PageTransitionEvent): void => {
    window.dispatchEvent(new Event('rinpaint:text-commit'));
    if (event.persisted) {
      // bfcache では同じインスタンスへ戻るため編集中の選択を確定しない。
      void this.flushSave();
      return;
    }
    // 浮動選択そのものは一時 UI だが、更新で画像内容まで失わないよう確定する。
    this.finishFloating();
    this.scheduleSave();
    void this.flushSave();
  };

  private scheduleStorageRefresh(): void {
    if (this.storageTimer !== null) clearTimeout(this.storageTimer);
    this.storageTimer = setTimeout(() => {
      this.storageTimer = null;
      void this.refreshStorageUsage();
    }, 120);
  }

  private async refreshStorageUsage(): Promise<void> {
    try {
      const persisted = await getPersistenceUsage();
      const history = this.history.retainedBytes();
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

export const engine = new PaintEngine();
