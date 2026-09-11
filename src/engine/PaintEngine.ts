import { useStore } from '../state/store';
import { Artboard } from './artboard';
import { EngineEvents } from './events';
import {
  type LayerMeta,
  type ShapeParams,
  type StrokePoint,
  type TextParams,
  type CanvasSpec,
  type ProjectFont,
} from '../model';
import { createTool, isToolKind, type ToolKind } from '../tools/registry';
import type { ActiveToolSettings, Tool, ToolSession } from '../tools/types';
import { LassoTool } from '../tools/lasso/tool';
import { PolygonTool } from '../tools/polygon/tool';
import { type DirtyRect } from './brush';
import {
  type HistoryTree,
  type LayerLocation,
  type LayerProps,
  type CanvasSnapshot,
} from './history/historyTree';
import { saveTimelapseEnabled, type SavedPage } from './persistence/db';
import { TimelapseRecorder } from './timelapse/recorder';
import { ViewController, type ViewState } from './view';
import { Compositor } from './core/Compositor';
import { LayerService } from './core/LayerService';
import { HistoryService } from './core/HistoryService';
import { InputController } from './core/InputController';
import { ShapeEditController } from './core/ShapeEditController';
import { ObjectTransform } from './core/ObjectTransform';
import { AutosaveService } from './core/AutosaveService';
import { PageService } from './core/PageService';
import { ProjectService } from './core/ProjectService';
import { ClipboardService } from './core/ClipboardService';
import { FillService } from './core/FillService';
import { PolygonSplitService } from './core/PolygonSplitService';
import { layerTypeProps } from './layer-types/registry';
import type { RasterLayer } from './layers';
import type { LayerParameterValue } from './layerParameters';
import { mmToPx } from './units';

export interface SelectedObjectTransform { id: string; before: LayerProps; width?: number; height?: number }

export class PaintEngine {
  readonly artboard = new Artboard();
  readonly events = new EngineEvents();

  /** @internal */ readonly compositor = new Compositor(this);
  /** @internal */ readonly layerService = new LayerService(this);
  /** @internal */ readonly historyService = new HistoryService(this);
  /** @internal */ readonly input = new InputController(this);
  /** @internal */ readonly shapeEdit = new ShapeEditController(this);
  /** @internal */ readonly objects = new ObjectTransform(this);
  /** @internal */ readonly autosave = new AutosaveService(this);
  /** @internal */ readonly pages = new PageService(this);
  /** @internal */ readonly project = new ProjectService(this);
  /** @internal */ readonly clipboard = new ClipboardService(this);
  /** @internal */ readonly fill = new FillService(this);
  /** @internal */ readonly polygonSplit = new PolygonSplitService(this);

  private recorder = new TimelapseRecorder(this, () => this.scheduleStorageRefresh());

  /** 遅延生成キャッシュ。種類を増やしても起動時コストは増えない。 */
  private readonly toolCache = new Map<ToolKind, Tool>();

  private busy = false;
  readonly view = new ViewController(this.artboard);
  private initPromise: Promise<void> | null = null;
  private lastViewState: ViewState = this.view.snapshot();

  private readonly nullTool: Tool = {
    onDown: () => undefined,
    onMove: () => undefined,
    onUp: () => undefined,
  };

  /** @internal — tests cast to HistoryTree */
  get history(): HistoryTree { return this.historyService.history; }
  set history(value: HistoryTree) { this.historyService.history = value; }

  private toolInstance(kind: ToolKind): Tool {
    let tool = this.toolCache.get(kind);
    if (!tool) {
      tool = createTool(kind, this);
      this.toolCache.set(kind, tool);
    }
    return tool;
  }

  get lasso(): LassoTool { return this.toolInstance('lasso') as LassoTool; }
  get polygon(): PolygonTool { return this.toolInstance('polygon') as PolygonTool; }

  /** @internal */ activeSession(): ToolSession | null {
    return this.activeTool().session ?? null;
  }
  hasOpenSession(): boolean { return this.activeSession()?.active() ?? false; }
  cancelSessions(): void { this.activeSession()?.cancel(); }

  constructor() {
    useStore.subscribe((s, prev) => {
      if (
        s.penColor !== prev.penColor ||
        s.penSizeMm !== prev.penSizeMm ||
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
    this.autosave.attachLifecycle();
  }

  // ---------------------------------------------------------------- host accessors

  /** @internal */ isBusy(): boolean { return this.busy; }
  /** @internal */ setBusy(v: boolean): void { this.busy = v; }
  /** @internal */ getCanvasSpec(): CanvasSpec { return this.project.canvasSpec; }
  /** @internal */ syncTextRendersPublic(): void { this.compositor.syncTextRenders(); }
  /** @internal */ scheduleStorageRefresh(): void { this.autosave.scheduleStorageRefresh(); }
  /** @internal */ flushSavePublic(): Promise<void> { return this.autosave.flushSave(); }
  /** @internal */ restoreSavedPagePublic(page: SavedPage): Promise<void> { return this.project.restoreSavedPage(page); }
  /** @internal */ restoreCanvasSnapshotPublic(snapshot: CanvasSnapshot): Promise<void> { return this.project.restoreCanvasSnapshot(snapshot); }
  /** @internal */ recorderPublic(): TimelapseRecorder { return this.recorder; }
  /** @internal */ setLastViewState(view: ViewState): void { this.lastViewState = view; }
  /** @internal */ hasShapeEdit(): boolean { return this.shapeEdit.hasEdit(); }
  /** @internal */ allLayers() { return this.layerService.layers; }
  /** @internal */ layerById(id: string) { return this.layerService.byId(id); }
  /** @internal */ shapeLayerById(id: string) { return this.layerService.shapeById(id); }
  /** @internal */ getRootLayerIds(): string[] { return this.layerService.rootLayerIds; }
  /** @internal */ getActiveLayerId(): string { return this.layerService.activeLayerId; }
  /** @internal */ activeTool(): Tool {
    const kind = useStore.getState().tool;
    return kind && isToolKind(kind) ? this.toolInstance(kind) : this.nullTool;
  }
  /** @internal */ drawLoupeIfAny(ctx: CanvasRenderingContext2D): void { this.input.drawLoupeIfAny(ctx); }

  committed(): void {
    this.compositor.syncTextRenders();
    this.requestRender();
    this.syncStore();
    this.recorder.schedule();
    this.scheduleSave();
    this.scheduleStorageRefresh();
  }

  // ---------------------------------------------------------------- attach

  attach(main: HTMLCanvasElement, overlay: HTMLCanvasElement, wrapper: HTMLElement, area: HTMLElement): void {
    this.compositor.attachCanvases(main, overlay);
    this.view.attach(area, wrapper);
    this.input.attachListeners(area);
    this.compositor.startLoop();
    void this.init().then(() => {
      this.requestRender();
      this.syncStore();
    });
  }

  detach(): void {
    if (useStore.getState().fillProgress !== null) this.fill.cancel();
    this.input.detachListeners();
    this.compositor.detachCanvases();
    this.view.detach();
  }

  setFitWidth(w: number): void { this.view.setFitWidth(w); }
  resetView(): void { this.view.reset(); }

  private init(): Promise<void> {
    this.initPromise ??= this.project.doInit();
    return this.initPromise;
  }

  // ---------------------------------------------------------------- render

  requestRender(): void { this.compositor.requestRender(); }
  ensureComposited(): void { this.compositor.ensureComposited(); }
  async readyToRender(): Promise<void> { await this.compositor.readyToRender(); }
  compositeCanvas(): HTMLCanvasElement | null { return this.compositor.compositeCanvas(); }
  uiScale(): number { return 1 / this.view.displayScale(); }

  // ---------------------------------------------------------------- input / eyedropper

  getPixel(x: number, y: number): string { return this.input.getPixel(x, y); }

  // ---------------------------------------------------------------- layers / objects / history

  activeRaster(): RasterLayer | null { return this.layerService.activeRaster(); }
  selectedRasters(): RasterLayer[] { return this.layerService.selectedRasters(); }
  hasSelectedObjects(): boolean { return this.layerService.hasSelectedObjects(); }

  selectedObjectsInRect(rect: DirtyRect, polygon?: { x: number; y: number }[]): SelectedObjectTransform[] {
    return this.objects.selectedObjectsInRect(rect, polygon);
  }
  previewObjectGroup(entries: SelectedObjectTransform[], source: { x: number; y: number }[], target: { x: number; y: number }[]): void {
    this.objects.previewObjectGroup(entries, source, target);
  }
  commitObjectGroup(entries: SelectedObjectTransform[]): void { this.objects.commitObjectGroup(entries); }
  restoreObjectGroup(entries: SelectedObjectTransform[]): void { this.objects.restoreObjectGroup(entries); }

  commitRasterBatch(entries: { layer: RasterLayer; before: HTMLCanvasElement; rect: DirtyRect }[], label: string, objects: SelectedObjectTransform[] = []): void {
    this.historyService.commitRasterBatch(entries, label, objects);
  }
  captureBefore(layer: RasterLayer): void { this.compositor.captureBefore(layer); }
  restoreBefore(layer: RasterLayer): void { this.compositor.restoreBefore(layer); }
  commitRasterEdit(layer: RasterLayer, rect: DirtyRect, label: string): void {
    this.historyService.commitRasterEdit(layer, rect, label);
  }

  async undo(): Promise<void> { return this.historyService.undo(); }
  async redo(childIndex?: number): Promise<void> { return this.historyService.redo(childIndex); }
  pruneHistory(limit = 10): number { return this.historyService.pruneHistory(limit); }

  isTimelapseEnabled(): boolean { return useStore.getState().timelapseEnabled; }
  setTimelapseEnabled(enabled: boolean): void {
    const st = useStore.getState();
    if (st.timelapseEnabled === enabled) return;
    st.set({ timelapseEnabled: enabled });
    this.recorder.setEnabled(enabled);
    void saveTimelapseEnabled(enabled).catch(() => {});
  }

  getLayerCanvas(id: string): HTMLCanvasElement | null { return this.layerService.getLayerCanvas(id); }
  getShape(id: string): ShapeParams | null { return this.layerService.getShape(id); }
  bumpLayer(id: string): void { this.layerService.bumpLayer(id); }

  finishTextEditing(): boolean { return this.layerService.finishTextEditing(); }
  getText(id: string): TextParams | null { return this.layerService.getText(id); }
  updateText(id: string, before: TextParams, after: TextParams, preview = false): void {
    this.layerService.updateText(id, before, after, preview);
  }
  addTextLayer(text: TextParams): void { this.layerService.addTextLayer(text); }
  textAt(x: number, y: number): string | null { return this.layerService.textAt(x, y); }
  editTextLayer(id: string): void { this.layerService.editTextLayer(id); }
  async addFont(file: File): Promise<ProjectFont | null> { return this.project.addFont(file); }

  addRasterLayer(): void { this.layerService.addRasterLayer(); }
  addAdjustLayer(): void { this.layerService.addAdjustLayer(); }
  addShapeLayer(shape: ShapeParams): void { this.layerService.addShapeLayer(shape); }
  layerChildren(id: string): string[] { return this.layerService.layerChildren(id); }
  layerRootIds(): string[] { return this.layerService.layerRootIds(); }
  canMoveLayer(id: string, parentId: string | null): boolean { return this.layerService.canMoveLayer(id, parentId); }
  moveLayerAsTopChild(id: string, parentId: string): void { this.layerService.moveLayerAsTopChild(id, parentId); }
  moveLayerOut(id: string): void { this.layerService.moveLayerOut(id); }
  removeLayer(id: string): void { this.layerService.removeLayer(id); }
  canRemoveLayer(id: string): boolean { return this.layerService.canRemoveLayer(id); }
  moveLayer(id: string, to: LayerLocation): boolean { return this.layerService.moveLayer(id, to); }
  canMergeLayerDown(id = this.layerService.activeLayerId): boolean { return this.layerService.canMergeLayerDown(id); }
  canTransferShape(id = this.layerService.activeLayerId): boolean { return this.layerService.canTransferShape(id); }
  async mergeLayerDown(id = this.layerService.activeLayerId): Promise<void> { return this.layerService.mergeLayerDown(id); }
  transferShapeLayer(): void { this.layerService.transferShapeLayer(); }
  convertRectToPolygon(id?: string): void { this.layerService.convertRectToPolygon(id); }
  setActiveLayer(id: string): void { this.layerService.setActiveLayer(id); }
  previewLayerProps(id: string, props: LayerProps): void { this.layerService.previewLayerProps(id, props); }
  commitLayerProps(id: string, before: LayerProps, after: LayerProps, label: string): void {
    this.layerService.commitLayerProps(id, before, after, label);
  }
  updateShapeParams(id: string, before: ShapeParams, after: ShapeParams, preview = false): void {
    this.layerService.updateShapeParams(id, before, after, preview);
  }

  beginShapeEdit(point: StrokePoint, event?: PointerEvent): boolean { return this.shapeEdit.beginShapeEdit(point, event); }
  updateShapeEdit(point: StrokePoint, event?: PointerEvent): boolean { return this.shapeEdit.updateShapeEdit(point, event); }
  finishShapeEdit(point: StrokePoint): boolean { return this.shapeEdit.finishShapeEdit(point); }
  cancelShapeEdit(): void { this.shapeEdit.cancelShapeEdit(); }
  drawActiveShapeHandles(ctx: CanvasRenderingContext2D): void { this.shapeEdit.drawActiveShapeHandles(ctx); }
  setPolygonVertexEdgeConstrained(value: boolean): void { this.shapeEdit.setPolygonVertexEdgeConstrained(value); }
  deleteSelectedPolygonVertex(): void { this.shapeEdit.deleteSelectedVertex(); }

  // ---------------------------------------------------------------- tools / misc

  setPenSizeMm(n: number): void {
    useStore.getState().setPenSizeMm(n);
    this.scheduleSave();
  }

  setPenColor(c: string): void {
    useStore.getState().setPenColor(c);
    this.scheduleSave();
  }

  activeToolSettings(): ActiveToolSettings | null {
    const st = useStore.getState();
    if (!st.tool || !st.activeToolId) return null;
    const inst = st.tools.find((t) => t.id === st.activeToolId);
    const sizeMm = st.penSizeMm;
    return {
      kind: st.tool,
      color: st.penColor,
      sizeMm,
      sizePx: mmToPx(sizeMm, st.canvasSpec.ppi),
      settings: inst?.settings,
    };
  }

  updateActiveToolSettings(patch: Record<string, unknown>): void {
    useStore.getState().updateActiveToolSettings(patch);
    this.scheduleSave();
  }

  pushColor(color: string): void {
    useStore.getState().pushColor(color);
  }

  setSelectionState(state: { active: boolean; freeTransform: boolean }): void {
    useStore.getState().set({
      selectionActive: state.active,
      freeTransform: state.freeTransform,
    });
  }

  setPolygonDraftState(state: { active: boolean; pointCount: number }): void {
    useStore.getState().set({
      polygonDraftActive: state.active,
      polygonDraftPointCount: state.pointCount,
    });
  }

  polygonCommit(): void { this.polygon.commit(); }
  polygonCancel(): void { this.polygon.cancel(); }
  polygonUndoPoint(): void { this.polygon.undoPoint(); }
  cancelFill(): void { this.fill.cancel(); }
  notify(message: string): void { useStore.getState().set({ toolNotice: message }); }

  selectToolInstance(id: string): void {
    if (this.busy && useStore.getState().fillProgress !== null) this.fill.cancel();
    if (this.busy) return;
    const st = useStore.getState();
    const inst = st.tools.find((t) => t.id === id);
    if (!inst) return;
    if (id === st.activeToolId) {
      this.layerService.finishFloating();
      this.activeTool().cancel?.();
      st.deactivateTool();
      this.requestRender();
      this.scheduleSave();
      return;
    }
    if (inst.kind !== st.tool) {
      this.layerService.finishFloating();
      this.activeTool().cancel?.();
    }
    st.activateTool(id);
    this.requestRender();
    this.syncStore();
  }

  addToolInstance(kind: ToolKind): void {
    if (this.busy && useStore.getState().fillProgress !== null) this.fill.cancel();
    if (this.busy) return;
    const st = useStore.getState();
    if (kind !== st.tool) {
      this.layerService.finishFloating();
      this.activeTool().cancel?.();
    }
    st.addTool(kind);
    this.requestRender();
    this.syncStore();
  }

  removeToolInstance(id: string): void {
    if (this.busy) return;
    const st = useStore.getState();
    if (id === st.activeToolId) {
      this.layerService.finishFloating();
      this.activeTool().cancel?.();
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
  reorderToolLayout(from: number, to: number): void {
    if (this.busy) return;
    useStore.getState().reorderToolLayout(from, to);
    this.scheduleSave();
  }
  createToolStack(sourceToolId: string, targetToolId: string): void {
    useStore.getState().createToolStack(sourceToolId, targetToolId);
    this.scheduleSave();
  }
  moveToolToStack(toolId: string, stackId: string, targetIndex?: number): void {
    useStore.getState().moveToolToStack(toolId, stackId, targetIndex);
    this.scheduleSave();
  }
  reorderStackTools(stackId: string, from: number, to: number): void {
    useStore.getState().reorderStackTools(stackId, from, to);
    this.scheduleSave();
  }
  unstackTool(toolId: string, targetIndex?: number): void {
    useStore.getState().unstackTool(toolId, targetIndex);
    this.scheduleSave();
  }
  dissolveToolStack(stackId: string): void {
    useStore.getState().dissolveToolStack(stackId);
    this.scheduleSave();
  }
  renameToolInstance(id: string, name: string): boolean {
    if (!name.trim()) return false;
    const tool = useStore.getState().tools.find(item => item.id === id);
    if (!tool) return false;
    if (tool.name === name) return true;
    useStore.getState().renameTool(id, name);
    this.scheduleSave();
    return true;
  }
  renameToolStack(id: string, name: string): boolean {
    if (!name.trim()) return false;
    const stack = useStore.getState().toolStacks.find(item => item.id === id);
    if (!stack) return false;
    if (stack.name === name) return true;
    useStore.getState().renameToolStack(id, name);
    this.scheduleSave();
    return true;
  }

  renameLayer(id: string, name: string): boolean { return this.layerService.renameLayer(id, name); }
  beginMultiSelect(id: string): void { this.layerService.beginMultiSelect(id); }
  exitMultiSelect(): void { this.layerService.exitMultiSelect(); }
  commitSelectedLayerProps(before: LayerProps, after: LayerProps, label: string): void {
    this.layerService.commitSelectedLayerProps(before, after, label);
  }
  previewSelectedLayerProps(props: LayerProps): void { this.layerService.previewSelectedLayerProps(props); }
  updateSelectedShapes(update: (shape: ShapeParams) => ShapeParams): void {
    this.layerService.updateSelectedShapes(update);
  }
  updateSelectedParameter(key: string, value: LayerParameterValue): void {
    this.layerService.updateSelectedParameter(key, value);
  }
  commitSelectedLayerOpacity(beforeById: Record<string, number>, opacity: number): void {
    this.layerService.commitSelectedLayerOpacity(beforeById, opacity);
  }

  async copyLayers(menuLayerId?: string): Promise<void> { return this.clipboard.copyLayers(menuLayerId); }
  async pasteLayers(): Promise<void> { return this.clipboard.pasteLayers(); }

  async addPage(): Promise<void> { return this.pages.addPage(); }
  async switchPage(id: string): Promise<void> { return this.pages.switchPage(id); }
  async deletePage(id: string): Promise<void> { return this.pages.deletePage(id); }
  async reorderPages(from: number, to: number): Promise<void> { return this.pages.reorderPages(from, to); }

  setSelectionFreeTransform(on: boolean): void { this.lasso.setFreeTransform(on); }
  async resizeCanvas(spec: CanvasSpec): Promise<void> { return this.project.resizeCanvas(spec); }
  async newProject(): Promise<void> { return this.project.newProject(); }

  lassoCommit(): void { this.lasso.commit(); this.syncStore(); }
  lassoDuplicate(): void { this.lasso.duplicate(); }
  lassoCancel(): void { this.lasso.cancelSelection(); this.scheduleSave(); }

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
    this.layerService.finishFloating();
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

  async exportPNG(): Promise<void> { return this.project.exportPNG(); }
  async exportProject(): Promise<void> { return this.project.exportProject(); }
  async importProject(file: File): Promise<void> { return this.project.importProject(file); }

  syncStore(): void {
    const ls = this.layerService;
    const metas: LayerMeta[] = ls.layers.map((l) => ({
      ...layerTypeProps(l),
      id: l.id,
      type: l.type,
      name: l.name,
      opacity: l.opacity,
      blend: l.blend,
      visible: l.visible,
      parentId: l.parentId,
      childIds: [...l.childIds],
      version: ls.versions.get(l.id) ?? 0,
      canMergeDown: ls.canMergeLayerDown(l.id),
      canRemove: ls.canRemoveLayer(l.id),
      canTransferShape: ls.canTransferShape(l.id),
    }));
    const state = useStore.getState();
    let selectedLayerIds = state.multiSelectMode
      ? state.selectedLayerIds.filter(id => ls.byId(id))
      : [ls.activeLayerId].filter(Boolean);
    let multiSelectMode = state.multiSelectMode;
    if (multiSelectMode && selectedLayerIds.length <= 1 && selectedLayerIds.length < state.selectedLayerIds.length) {
      multiSelectMode = false;
      if (selectedLayerIds[0]) ls.activeLayerId = selectedLayerIds[0];
      selectedLayerIds = [ls.activeLayerId].filter(Boolean);
    }
    useStore.getState().set({
      layers: metas,
      rootLayerIds: ls.layerRootIds(),
      activeLayerId: ls.activeLayerId,
      selectedLayerIds,
      multiSelectMode,
      pages: this.pages.pageOrder.map(id => ({
        id,
        thumbnailVersion: id === this.pages.activePageId
          ? this.pages.thumbnailVersion
          : state.pages.find(page => page.id === id)?.thumbnailVersion ?? 0,
      })),
      activePageId: this.pages.activePageId,
      canUndo: this.history.canUndo(),
      canRedo: this.history.canRedo(),
      redoBranches: this.history.current.children.map((c, i) => ({ index: i, label: c.label })),
      historyCount: this.history.nodeCount(),
      historyPrunableCount: this.history.prunableCount(10),
      selectionActive: this.lasso.phase === 'float',
      freeTransform: this.lasso.phase === 'float' && this.lasso.free,
    });
  }

  scheduleSave(): void { this.autosave.scheduleSave(); }

  /** @internal — tests call via cast */
  flushSave(): Promise<void> { return this.autosave.flushSave(); }
}
