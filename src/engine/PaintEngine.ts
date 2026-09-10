import { useStore } from '../state/store';
import {
  ART_H,
  ART_W,
  DEFAULT_ADJUST,
  normalizePenDetailSettings,
  setArtSize,
  TRANSPARENT,
  type LayerMeta,
  type ShapeParams,
  type StrokePoint,
  type ToolInstance,
  type ToolKind,
} from '../types';
import { checkerPattern, rectValid, type DirtyRect } from './brush';
import {
  HistoryTree,
  type LayerLocation,
  type LocatedLayerSnapshot,
  type LayerProps,
  type LayerSnapshot,
  type Op,
} from './history/historyTree';
import { applyTiles, extractTiles } from './history/tilePatch';
import {
  buildFilter,
  createAdjustLayer,
  createRasterLayer,
  createShapeLayer,
  makeCanvas,
  type Layer,
  type RasterLayer,
  type ShapeLayer,
} from './layers';
import { drawShape, shapeBounds, translateShape } from './shapes';
import { canReparent, closestRasterOrRoot, structuralLowerId, validateLayerTree } from './layerTree';
import {
  getPersistenceUsage,
  loadProject,
  loadTimelapseEnabled,
  saveProject,
  saveTimelapseEnabled,
  type SavedLayer,
} from './persistence/db';
import {
  blobToDataURL,
  dataURLToBlob,
  parseProjectFile,
  type ProjectFile,
  type ProjectFileLayer,
} from './persistence/projectFile';
import { downloadBlob } from './timelapse/exporter';
import { TimelapseRecorder } from './timelapse/recorder';
import { BlurTool } from './tools/blur';
import { LassoTool } from './tools/lasso';
import { PenTool } from './tools/pen';
import { ShapeTool } from './tools/shape';
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
  mode: 'move' | 'start' | 'end' | 'nw' | 'ne' | 'sw' | 'se';
  start: StrokePoint;
  before: ShapeParams;
}

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
  private lastViewState: ViewState = this.view.snapshot();

  constructor() {
    useStore.subscribe((s, prev) => {
      if (
        s.penColor !== prev.penColor ||
        s.penSize !== prev.penSize ||
        s.colorHistory !== prev.colorHistory ||
        s.tools !== prev.tools ||
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
    for (const c of [this.scratch, this.tmp, this.shapeTmp]) {
      if (c.width !== ART_W || c.height !== ART_H) {
        c.width = ART_W;
        c.height = ART_H;
      }
    }
  }

  /** 保存データのツールインスタンスを検証して store に反映する */
  private restoreTools(tools: unknown, activeToolId: unknown): void {
    if (!Array.isArray(tools)) return;
    const kinds: ToolKind[] = ['pen', 'line', 'rect', 'ellipse', 'lasso', 'blur'];
    const valid = tools.filter(
      (t): t is ToolInstance =>
        !!t &&
        typeof t.id === 'string' &&
        kinds.includes(t.kind) &&
        typeof t.name === 'string' &&
        typeof t.size === 'number' &&
        typeof t.color === 'string',
    ).map((tool) =>
      tool.kind === 'pen'
        ? { ...tool, penSettings: normalizePenDetailSettings(tool.penSettings) }
        : tool,
    );
    if (valid.length === 0) return;
    const st = useStore.getState();
    st.set({ tools: valid });
    const active = valid.some((t) => t.id === activeToolId)
      ? (activeToolId as string)
      : valid[0].id;
    st.activateTool(active);
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
      if (proj?.version === 2 && proj.layers.length > 0) {
        if (proj.width && proj.height) setArtSize(proj.width, proj.height);
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
            l.parentId = sl.parentId;
            l.childIds = [...sl.childIds];
            this.layers.push(l);
            this.adjustCounter++;
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
        this.restoreTools(proj.tools, proj.activeToolId);
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
    }
    this.fixActive();
    if (restoredHistory) this.history.restore(restoredHistory);
    if (restoredView) this.view.restore(restoredView);
    this.lastViewState = this.view.snapshot();
    this.initialized = true;
    this.scheduleStorageRefresh();
  }

  // ---------------------------------------------------------------- render

  requestRender(): void {
    this.dirty = true;
  }

  ensureComposited(): void {
    if (this.dirty) this.composite();
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
        if (l.id === this.activeLayerId) tool.drawAboveLayer?.(ctx);
      } else if (l.visible && l.type === 'shape' && l.shape.color !== TRANSPARENT) {
        ctx.globalAlpha = l.opacity;
        ctx.globalCompositeOperation = l.blend;
        drawShape(ctx, l.shape);
      } else if (l.visible && l.type === 'adjust') {
        this.tmpCtx.save();
        this.tmpCtx.clearRect(0, 0, ART_W, ART_H);
        this.tmpCtx.filter = buildFilter(l.params);
        this.tmpCtx.drawImage(this.main!, 0, 0);
        this.tmpCtx.restore();
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
    return this.tools[useStore.getState().tool];
  }

  /** キャンバス上に重ねた UI (選択ツールバー等) の操作は無視する */
  private isUiTarget(e: Event): boolean {
    const t = e.target as Element | null;
    return !!t && !!t.closest('button, [data-canvas-ui]');
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.isUiTarget(e)) return;
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
    const meta = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (meta && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) void this.redo();
      else void this.undo();
    } else if (meta && key === 'y') {
      e.preventDefault();
      void this.redo();
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
    this.requestRender();
    this.syncStore();
    this.scheduleSave();
    // タイムラプスには undo/redo を記録しない
  }

  private async applyOp(op: Op, dir: 'undo' | 'redo'): Promise<void> {
    switch (op.kind) {
      case 'raster': {
        const layer = this.rasterById(op.layerId);
        if (layer) {
          await applyTiles(layer, op.tiles, dir === 'undo' ? 'before' : 'after');
          this.bumpLayer(layer.id);
        }
        break;
      }
      case 'layerAdd': {
        if (dir === 'redo') await this.restoreLayer(op.snapshot, op.location);
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
        const remove = dir === 'undo' ? op.after : op.before;
        const restore = dir === 'undo' ? op.before : op.after;
        for (const entry of remove) this.removeLayerExact(entry.snapshot.id);
        await this.restoreEntries(restore);
        this.activeLayerId =
          dir === 'undo' ? op.beforeActiveId : op.afterActiveId;
        break;
      }
    }
  }

  private committed(): void {
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
    return l && l.type === 'raster' ? l.canvas : null;
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
    } else if (l.type === 'shape') {
      snap.shape = { ...l.shape };
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
      layer = l;
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
    if (this.lasso.phase === 'float') this.lasso.commit();
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
    this.removeLayerInternal(id);
    this.history.push({ kind: 'layerRemove', location, snapshots }, 'レイヤー削除');
    this.fixActive();
    this.committed();
  }

  moveLayer(id: string, to: LayerLocation): void {
    if (this.busy) return;
    const from = this.locationOf(id);
    if (!from || !canReparent(this.layers, id, to.parentId)) return;
    this.detachLayer(id);
    const adjusted = { ...to };
    if (from.parentId === to.parentId && from.index < to.index) adjusted.index--;
    this.insertAt(id, adjusted);
    this.history.push({ kind: 'layerMove', layerId: id, from, to: adjusted }, 'レイヤー並べ替え');
    this.committed();
  }

  private stableLayerEntries(
    layers: Layer[],
  ): LocatedLayerSnapshot[] {
    return layers.map((layer) => ({
      location: this.locationOf(layer.id)!,
      snapshot: this.snapshotLayer(layer, layer.type === 'raster', true),
    }));
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
      else drawShape(target.ctx, source.shape);
      target.ctx.restore();
    }
  }

  /** 選択中の葉レイヤーを、構造上の直下のラスターへ統合する。 */
  mergeLayerDown(): void {
    if (this.busy) return;
    this.finishFloating();
    const upper = this.byId(this.activeLayerId);
    if (!upper) return;
    const lower = this.mergeTarget(upper);
    if (!lower) return;

    const beforeActiveId = this.activeLayerId;
    const before = this.stableLayerEntries([lower, upper]);
    this.bakeLayerOnto(lower, upper);
    this.removeLayerInternal(upper.id);
    this.activeLayerId = lower.id;
    this.bumpLayer(lower.id);
    const after = this.stableLayerEntries([lower]);
    this.history.push(
      {
        kind: 'layerMerge',
        before,
        after,
        beforeActiveId,
        afterActiveId: lower.id,
      },
      '下のレイヤーと統合',
    );
    this.committed();
  }

  transferShapeLayer(): void {
    if (!this.canTransferShape()) return;
    const shape = this.shapeById(this.activeLayerId)!;
    const parent = this.rasterById(shape.parentId!)!;
    const beforeActiveId = shape.id;
    const before = this.stableLayerEntries([parent, shape]);
    this.bakeLayerOnto(parent, shape);
    this.removeLayerInternal(shape.id);
    this.activeLayerId = parent.id;
    this.bumpLayer(parent.id);
    const after = this.stableLayerEntries([parent]);
    this.history.push(
      {
        kind: 'layerMerge',
        before,
        after,
        beforeActiveId,
        afterActiveId: parent.id,
      },
      '図形を転写',
    );
    this.committed();
  }

  setActiveLayer(id: string): void {
    if (!this.byId(id) || id === this.activeLayerId) return;
    this.finishFloating();
    this.activeLayerId = id;
    this.requestRender();
    this.syncStore();
    this.scheduleSave();
  }

  private assignProps(l: Layer, p: LayerProps): void {
    if (p.opacity !== undefined) l.opacity = p.opacity;
    if (p.blend !== undefined) l.blend = p.blend;
    if (p.visible !== undefined) l.visible = p.visible;
    if (p.params !== undefined && l.type === 'adjust') l.params = { ...p.params };
    if (p.shape !== undefined && l.type === 'shape') l.shape = { ...p.shape };
  }

  /** スライダードラッグ中のライブ反映 (履歴は積まない) */
  previewLayerProps(id: string, props: LayerProps): void {
    const l = this.byId(id);
    if (!l) return;
    this.assignProps(l, props);
    this.requestRender();
    this.syncStore();
  }

  /** 値の確定 (before → after を1つの履歴ノードとして積む) */
  commitLayerProps(id: string, before: LayerProps, after: LayerProps, label: string): void {
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
    if (shape.kind === 'line') {
      if (near(shape.x1, shape.y1)) mode = 'start';
      else if (near(shape.x2, shape.y2)) mode = 'end';
    } else {
      const b = shapeBounds(shape);
      const corners = [
        ['nw', b.x, b.y], ['ne', b.x + b.w, b.y],
        ['sw', b.x, b.y + b.h], ['se', b.x + b.w, b.y + b.h],
      ] as const;
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
    else if (edit.before.kind === 'line') {
      next = edit.mode === 'start'
        ? { ...edit.before, x1: point.x, y1: point.y }
        : { ...edit.before, x2: point.x, y2: point.y };
    } else {
      const b = shapeBounds(edit.before);
      const left = edit.mode.endsWith('w') ? point.x : b.x;
      const right = edit.mode.endsWith('e') ? point.x : b.x + b.w;
      const top = edit.mode.startsWith('n') ? point.y : b.y;
      const bottom = edit.mode.startsWith('s') ? point.y : b.y + b.h;
      const x = Math.min(left, right);
      const y = Math.min(top, bottom);
      const w = Math.max(0.01, Math.abs(right - left));
      const h = Math.max(0.01, Math.abs(bottom - top));
      next = edit.before.kind === 'rect'
        ? { ...edit.before, x, y, width: w, height: h }
        : { ...edit.before, cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 };
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
      : [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
    const scale = this.uiScale();
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
    ctx.restore();
  }

  // ---------------------------------------------------------------- tools / misc

  /** ツールインスタンスを切り替える (記憶された色・太さも反映される) */
  selectToolInstance(id: string): void {
    const st = useStore.getState();
    const inst = st.tools.find((t) => t.id === id);
    if (!inst || id === st.activeToolId) return;
    if (inst.kind !== st.tool) {
      this.finishFloating();
      this.lasso.cancel();
    }
    st.activateTool(id);
    this.requestRender();
    this.syncStore();
  }

  addToolInstance(kind: ToolKind): void {
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
    useStore.getState().reorderTools(from, to);
    this.scheduleSave();
  }

  /** 浮動選択の自由変形モードを切り替える */
  setSelectionFreeTransform(on: boolean): void {
    this.lasso.setFreeTransform(on);
  }

  /** キャンバスサイズを変更する (内容は左上基準で保持、履歴はリセット) */
  resizeCanvas(w: number, h: number): void {
    if (this.busy) return;
    w = Math.round(w);
    h = Math.round(h);
    if (w === ART_W && h === ART_H) return;
    // 浮動選択はリサイズ前のスクラッチに依存するため先に確定する
    this.finishFloating();
    this.lasso.cancelSelection();
    setArtSize(w, h);
    for (const l of this.layers) {
      if (l.type !== 'raster') continue;
      const old = l.canvas;
      const canvas = makeCanvas(ART_W, ART_H);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(old, 0, 0);
      l.canvas = canvas;
      l.ctx = ctx;
      this.bumpLayer(l.id);
    }
    this.syncWorkCanvases();
    // 履歴のタイルパッチは旧サイズ前提なのでリセットする
    this.history = new HistoryTree();
    useStore.getState().set({ canvasW: ART_W, canvasH: ART_H });
    this.view.reset();
    this.requestRender();
    this.syncStore();
    this.scheduleSave();
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

  exportPNG(): void {
    if (!this.main) return;
    this.ensureComposited();
    void toBlobP(this.main).then((b) => downloadBlob(b, 'rin-paint.png'));
  }

  // ---------------------------------------------------------------- project file

  async exportProject(): Promise<void> {
    this.finishFloating();
    const st = useStore.getState();
    const layers: ProjectFileLayer[] = [];
    for (const l of this.layers) {
      const base = {
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
        layers.push({ ...base, params: { ...l.params } });
      } else if (l.type === 'shape') {
        layers.push({ ...base, shape: { ...l.shape } });
      } else {
        layers.push({ ...base, png: await blobToDataURL(await toBlobP(l.canvas)) });
      }
    }
    const file: ProjectFile = {
      app: 'rin-paint',
      version: 2,
      rootLayerIds: [...this.rootLayerIds],
      activeLayerId: this.activeLayerId,
      penColor: st.penColor,
      penSize: st.penSize,
      colorHistory: st.colorHistory,
      layers,
      width: ART_W,
      height: ART_H,
      tools: st.tools,
      activeToolId: st.activeToolId,
    };
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    downloadBlob(blob, `rin-paint-${new Date().toISOString().slice(0, 10)}.rinpaint`);
  }

  /** プロジェクトファイルを読み込み、現在の内容と履歴を置き換える */
  async importProject(file: File): Promise<void> {
    if (this.busy) throw new Error('busy');
    const proj = parseProjectFile(await file.text());
    this.busy = true;
    try {
      this.lasso.cancelSelection();
      setArtSize(proj.width ?? 1600, proj.height ?? 1200);
      this.syncWorkCanvases();
      const layers: Layer[] = [];
      let rasterCount = 0;
      let adjustCount = 0;
      for (const pl of proj.layers) {
        if (pl.type === 'adjust') {
          const l = createAdjustLayer(pl.name ?? `色調補正 ${++adjustCount}`, pl.id);
          l.params = { ...DEFAULT_ADJUST, ...(pl.params ?? {}) };
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
          if (pl.png) {
            const bmp = await createImageBitmap(await dataURLToBlob(pl.png));
            l.ctx.drawImage(bmp, 0, 0);
            bmp.close();
          }
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
      for (const l of layers) this.bumpLayer(l.id);
      useStore.getState().set({
        penColor: typeof proj.penColor === 'string' ? proj.penColor : '#222222',
        penSize: typeof proj.penSize === 'number' ? proj.penSize : 14,
        colorHistory: Array.isArray(proj.colorHistory)
          ? proj.colorHistory
          : useStore.getState().colorHistory,
        canvasW: ART_W,
        canvasH: ART_H,
      });
      this.restoreTools(proj.tools, proj.activeToolId);
      this.fixActive();
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
      shape: l.type === 'shape' ? { ...l.shape } : undefined,
      version: this.versions.get(l.id) ?? 0,
    }));
    useStore.getState().set({
      layers: metas,
      activeLayerId: this.activeLayerId,
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
      if (l.type === 'adjust') {
        return {
          id: l.id,
          type: l.type,
          name: l.name,
          opacity: l.opacity,
          blend: l.blend,
          visible: l.visible,
          params: { ...l.params },
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
    const width = ART_W;
    const height = ART_H;
    const penColor = st.penColor;
    const penSize = st.penSize;
    const colorHistory = [...st.colorHistory];
    const tools = st.tools.map((tool) => ({
      ...tool,
      penSettings: tool.penSettings ? { ...tool.penSettings } : undefined,
    }));
    const activeToolId = st.activeToolId;
    const historyPromise = this.history.serialize(toBlobP);
    const layers: SavedLayer[] = await Promise.all(
      layerSources.map(async (l) => {
        if (l.type !== 'raster') return l;
        const { canvas, ...meta } = l;
        return { ...meta, blob: await toBlobP(canvas) };
      }),
    );
    await saveProject({
      version: 2,
      rootLayerIds: [...this.rootLayerIds],
      layers,
      activeLayerId,
      penColor,
      penSize,
      colorHistory,
      width,
      height,
      tools,
      activeToolId,
      history: await historyPromise,
      view,
    });
    this.scheduleStorageRefresh();
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') void this.flushSave();
  };

  private onPageHide = (event: PageTransitionEvent): void => {
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
