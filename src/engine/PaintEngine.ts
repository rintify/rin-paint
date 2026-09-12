import { useStore } from '../state/store';
import { Artboard } from './artboard';
import { EngineEvents } from './events';
import {
  type LayerMeta,
  type LayerAddress,
  type ShapeParams,
  type StrokePoint,
  type TextParams,
  type CanvasSpec,
  type ProjectFont,
} from '../model';
import { createTool, isToolKind, type ToolKind } from '../tools/registry';
import type { ActiveToolSettings, Tool, ToolSession } from '../tools/types';
import { LassoTool } from '../tools/lasso/tool';
import { MoveTool } from '../tools/move/tool';
import { PolygonTool } from '../tools/polygon/tool';
import { isFloatTool, type FloatSelection } from '../tools/transform/floatSelection';
import { type DirtyRect } from './brush';
import {
  type HistoryTree,
  type LayerLocation,
  type LayerProps,
  type CanvasSnapshot,
} from './history/historyTree';
import type { SavedPage } from './persistence/db';
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
import { SettingsService } from './core/SettingsService';
import { ParameterLinkService, type LayerLinkCandidate } from './core/ParameterLinkService';
import { layerHandler, layerTypeProps } from './layer-types/registry';
import type { RasterLayer } from './layers';
import type { LayerParameterValue } from './layerParameters';
import { mmToPx } from './units';
import { rotatedRectBounds } from './shapes/snap';
import { imageToolBoxPx } from '../tools/image/settings';
import { canvasFromImageFile } from './image/load';
import {
  normalizeEyedropperToolSettings,
  type EyedropperSource,
} from '../tools/eyedropper/settings';

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
  /** @internal */ readonly links = new ParameterLinkService(this);
  /** @internal */ readonly project = new ProjectService(this);
  /** @internal */ readonly clipboard = new ClipboardService(this);
  /** @internal */ readonly fill = new FillService(this);
  /** @internal */ readonly polygonSplit = new PolygonSplitService(this);
  /** @internal */ readonly settings = new SettingsService(this);

  private recorder = new TimelapseRecorder(this, () => this.scheduleStorageRefresh());

  /** 遅延生成キャッシュ。種類を増やしても起動時コストは増えない。 */
  private readonly toolCache = new Map<ToolKind, Tool>();

  private busy = false;
  readonly view = new ViewController(this.artboard);
  private initPromise: Promise<void> | null = null;
  private lastViewState: ViewState = this.view.snapshot();
  private toolBeforeEyedropperId: string | null = null;

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
  get move(): MoveTool { return this.toolInstance('move') as MoveTool; }
  get polygon(): PolygonTool { return this.toolInstance('polygon') as PolygonTool; }

  activeFloat(): FloatSelection | null {
    const tool = this.activeTool();
    return isFloatTool(tool) ? tool.floatSelection : null;
  }

  notifyLayerSelectionChange(): void {
    this.activeTool().onLayerSelectionChange?.();
  }

  /** @internal */ activeSession(): ToolSession | null {
    return this.activeTool().session ?? null;
  }
  hasOpenSession(): boolean { return this.activeSession()?.active() ?? false; }
  cancelSessions(): void { this.activeSession()?.cancel(); }

  constructor() {
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
      this.requestOverlayRender();
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
  /** @internal */ getMaskRevision(id: string): number { return this.layerService.maskVersions.get(id) ?? 0; }
  /** @internal */ getRenderRevision(id: string): number { return this.layerService.versions.get(id) ?? 0; }
  /** @internal */ shapeLayerById(id: string) { return this.layerService.shapeById(id); }
  /** @internal */ getRootLayerIds(): string[] { return this.layerService.rootLayerIds; }
  /** @internal */ getActiveLayerId(): string { return this.layerService.activeLayerId; }
  /** @internal */ activeTool(): Tool {
    const kind = useStore.getState().tool;
    return kind && isToolKind(kind) ? this.toolInstance(kind) : this.nullTool;
  }
  /** @internal */ drawLoupeIfAny(ctx: CanvasRenderingContext2D): void { this.input.drawLoupeIfAny(ctx); }

  committed(requestFullRender = true): void {
    this.compositor.syncTextRenders();
    if (requestFullRender) this.requestRender();
    this.syncStore();
    this.recorder.schedule();
    this.scheduleSave();
    this.scheduleStorageRefresh();
  }

  // ---------------------------------------------------------------- attach

  attach(main: HTMLCanvasElement, overlay: HTMLCanvasElement, wrapper: HTMLElement, area: HTMLElement): void {
    this.compositor.attachCanvases(main, overlay, area);
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
    this.initPromise ??= (async () => {
      await this.settings.init();
      await this.project.doInit();
      await this.links.refreshCatalog();
      this.links.reconcileAll();
    })();
    return this.initPromise;
  }

  // ---------------------------------------------------------------- render

  requestRender(): void { this.compositor.requestRender(); }
  requestOverlayRender(): void { this.compositor.requestOverlayRender(); }
  ensureComposited(): void { this.compositor.ensureComposited(); }
  async readyToRender(): Promise<void> { await this.compositor.readyToRender(); }
  compositeCanvas(): HTMLCanvasElement | null { return this.compositor.compositeCanvas(); }
  uiScale(): number { return 1 / this.view.displayScale(); }

  // ---------------------------------------------------------------- input / eyedropper

  getPixel(x: number, y: number, source: EyedropperSource = 'active-layer'): string {
    return this.input.getPixel(x, y, source);
  }
  beginEyedropper(point: StrokePoint, pointerId: number, source: EyedropperSource, restorePreviousTool = false): void {
    this.input.beginEyedropper(point, pointerId, source, restorePreviousTool);
  }
  cancelEyedropper(): void { this.input.cancelEyedropper(); }
  longPressEyedropperSource(): EyedropperSource {
    return normalizeEyedropperToolSettings(this.firstToolOfKind('eyedropper')?.settings).source;
  }
  firstToolOfKind(kind: ToolKind) {
    const state = useStore.getState();
    const orderedIds = state.toolLayout.flatMap((item) => {
      if (item.type === 'tool') return [item.toolId];
      return state.toolStacks.find((stack) => stack.id === item.stackId)?.toolIds ?? [];
    });
    return [...orderedIds, ...state.tools.map((tool) => tool.id)]
      .map((id) => state.tools.find((tool) => tool.id === id))
      .find((tool) => tool?.kind === kind);
  }

  async placeDroppedImage(file: File, clientX: number, clientY: number): Promise<boolean> {
    const canvas = await canvasFromImageFile(file);
    if (!canvas) return false;
    const tool = this.firstToolOfKind('image');
    if (!tool) {
      this.notify('画像ツールを追加してください');
      return true;
    }
    const box = imageToolBoxPx(tool.settings, this.getCanvasSpec().ppi);
    const point = this.view.clientToArt(clientX, clientY);
    this.addImageLayer(canvas, point.x, point.y, box.width, box.height);
    return true;
  }

  replaceImageContent(id: string, canvas: HTMLCanvasElement): void {
    this.layerService.replaceImageContent(id, canvas);
  }
  fitImageAspect(id: string): void {
    this.layerService.fitImageAspect(id);
  }

  applyPickedColor(color: string, restorePreviousTool: boolean): void {
    const state = useStore.getState();
    if (restorePreviousTool && this.toolBeforeEyedropperId
      && state.tools.some((tool) => tool.id === this.toolBeforeEyedropperId)) {
      state.activateTool(this.toolBeforeEyedropperId);
    }
    const next = useStore.getState();
    next.setPenColor(color);
    next.pushColor(color);
    this.toolBeforeEyedropperId = null;
  }

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
  restoreBefore(layer: RasterLayer, rect?: DirtyRect): void { this.compositor.restoreBefore(layer, rect); }
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
  }

  getLayerCanvas(id: string): HTMLCanvasElement | null { return this.layerService.getLayerCanvas(id); }
  getShape(id: string): ShapeParams | null { return this.layerService.getShape(id); }
  objectBounds(id: string): { x: number; y: number; w: number; h: number } | null {
    const layer = this.layerService.byId(id);
    if (!layer) return null;
    const bounds = layerHandler(layer).objectTransform?.bounds(layer, this.compositor.measureEnv());
    if (!bounds) return null;
    return layer.type === 'text' ? rotatedRectBounds(bounds, layer.text.rotation ?? 0) : bounds;
  }
  visibleObjectBounds(excludeId: string): { x: number; y: number; w: number; h: number }[] {
    return this.layerService.layers.flatMap(layer => {
      if (layer.id === excludeId || !layer.visible || (layer.type !== 'shape' && layer.type !== 'text' && layer.type !== 'image')) return [];
      const bounds = this.objectBounds(layer.id);
      return bounds ? [bounds] : [];
    });
  }
  bumpLayer(id: string, rect?: DirtyRect): void { this.layerService.bumpLayer(id, rect); }
  invalidateLayer(id: string, rect: DirtyRect): void { this.layerService.bumpLayer(id, rect); }

  finishTextEditing(): boolean { return this.layerService.finishTextEditing(); }
  getText(id: string): TextParams | null { return this.layerService.getText(id); }
  updateText(id: string, before: TextParams, after: TextParams, preview = false): void {
    this.layerService.updateText(id, before, after, preview);
  }
  addTextLayer(text: TextParams): void { this.layerService.addTextLayer(text); }
  textAt(x: number, y: number): string | null { return this.layerService.textAt(x, y); }
  textFrameSize(id: string): { width: number; height: number } | null { return this.layerService.textFrameSize(id); }
  editTextLayer(id: string): void { this.layerService.editTextLayer(id); }
  async addFont(file: File): Promise<ProjectFont | null> { return this.project.addFont(file); }

  addRasterLayer(): void { this.layerService.addRasterLayer(); }
  addAdjustLayer(): void { this.layerService.addAdjustLayer(); }
  addOutlineLayer(): void { this.layerService.addOutlineLayer(); }
  addClipLayer(): void { this.layerService.addClipLayer(); }
  addShapeLayer(shape: ShapeParams): void { this.layerService.addShapeLayer(shape); }
  addImageLayer(canvas: HTMLCanvasElement, x: number, y: number, maxWidth: number, maxHeight: number): void {
    this.layerService.addImageLayer(canvas, x, y, maxWidth, maxHeight);
  }
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
  linkCandidates(id: string): LayerLinkCandidate[] { return this.links.candidates(id); }
  async changeLayerLinkSource(targetId: string, source: LayerAddress): Promise<void> { return this.links.changeSource(targetId, source); }
  removeLayerLink(targetId: string): void { this.links.removeLink(targetId); }
  unlinkLayerParameter(targetId: string, semanticId: string): void { this.links.unlinkParameter(targetId, semanticId); }
  unlinkLayerParameters(targetIds: string[], semanticId: string): void { this.links.unlinkParameters(targetIds, semanticId); }
  async relinkLayerParameter(targetId: string, semanticId: string): Promise<void> { return this.links.relink(targetId, semanticId); }
  async relinkAllLayerParameters(targetId: string): Promise<void> { return this.links.relink(targetId); }
  async focusLayerReference(address: LayerAddress): Promise<void> {
    if (address.pageId !== this.pages.activePageId) await this.pages.switchPage(address.pageId);
    window.dispatchEvent(new CustomEvent<string>('rin-paint:focus-layer-row', { detail: address.layerId }));
  }

  beginShapeEdit(point: StrokePoint, event?: PointerEvent): boolean { return this.shapeEdit.beginShapeEdit(point, event); }
  updateShapeEdit(point: StrokePoint, event?: PointerEvent): boolean { return this.shapeEdit.updateShapeEdit(point, event); }
  finishShapeEdit(point: StrokePoint): boolean { return this.shapeEdit.finishShapeEdit(point); }
  cancelShapeEdit(): void { this.shapeEdit.cancelShapeEdit(); }
  drawActiveShapeHandles(ctx: CanvasRenderingContext2D): void { this.shapeEdit.drawActiveShapeHandles(ctx); }
  setShapeHandleEdgeConstrained(value: boolean): void { this.shapeEdit.setShapeHandleEdgeConstrained(value); }
  deleteSelectedShapeVertex(): void { this.shapeEdit.deleteSelectedVertex(); }

  // ---------------------------------------------------------------- tools / misc

  setPenSizeMm(n: number): void {
    useStore.getState().setPenSizeMm(n);
  }

  setPenColor(c: string): void {
    useStore.getState().setPenColor(c);
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
    if (inst.kind === 'eyedropper' && st.tool !== 'eyedropper') {
      this.toolBeforeEyedropperId = st.activeToolId;
    }
    st.set({ shortcutTarget: { type: 'tool', id } });
    if (id === st.activeToolId) {
      this.layerService.finishFloating();
      this.activeTool().cancel?.();
      st.deactivateTool();
      this.requestRender();
      return;
    }
    if (inst.kind !== st.tool) {
      this.layerService.finishFloating();
      this.activeTool().cancel?.();
    }
    st.activateTool(id);
    this.activeTool().onActivate?.();
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
    this.activeTool().onActivate?.();
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
  }
  reorderToolLayout(from: number, to: number): void {
    if (this.busy) return;
    useStore.getState().reorderToolLayout(from, to);
  }
  createToolStack(sourceToolId: string, targetToolId: string): void {
    useStore.getState().createToolStack(sourceToolId, targetToolId);
  }
  moveToolToStack(toolId: string, stackId: string, targetIndex?: number): void {
    useStore.getState().moveToolToStack(toolId, stackId, targetIndex);
  }
  reorderStackTools(stackId: string, from: number, to: number): void {
    useStore.getState().reorderStackTools(stackId, from, to);
  }
  unstackTool(toolId: string, targetIndex?: number): void {
    useStore.getState().unstackTool(toolId, targetIndex);
  }
  dissolveToolStack(stackId: string): void {
    useStore.getState().dissolveToolStack(stackId);
  }
  renameToolInstance(id: string, name: string): boolean {
    if (!name.trim()) return false;
    const tool = useStore.getState().tools.find(item => item.id === id);
    if (!tool) return false;
    if (tool.name === name) return true;
    useStore.getState().renameTool(id, name);
    return true;
  }
  renameToolStack(id: string, name: string): boolean {
    if (!name.trim()) return false;
    const stack = useStore.getState().toolStacks.find(item => item.id === id);
    if (!stack) return false;
    if (stack.name === name) return true;
    useStore.getState().renameToolStack(id, name);
    return true;
  }

  renameLayer(id: string, name: string): boolean { return this.layerService.renameLayer(id, name); }
  beginMultiSelect(id: string): void { this.layerService.beginMultiSelect(id); }
  toggleDescendantSelection(id: string): void { this.layerService.toggleDescendantSelection(id); }
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
  previewSelectedParameter(key: string, value: LayerParameterValue): void {
    this.layerService.previewSelectedParameter(key, value);
  }
  commitSelectedParameterPreview(key: string, before: LayerParameterValue, value: LayerParameterValue): void {
    this.layerService.commitSelectedParameterPreview(key, before, value);
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

  setSelectionFreeTransform(on: boolean): void { this.activeFloat()?.setFreeTransform(on); }
  async resizeCanvas(spec: CanvasSpec): Promise<void> { return this.project.resizeCanvas(spec); }
  async newProject(): Promise<void> { return this.project.newProject(); }

  commitFloatSelection(): void { this.activeSession()?.commit(); this.syncStore(); }
  duplicateFloatSelection(): void {
    const tool = this.activeTool();
    if ('duplicate' in tool && typeof (tool as { duplicate?: () => void }).duplicate === 'function') {
      (tool as { duplicate: () => void }).duplicate();
    }
  }
  cancelFloatSelection(): void { this.activeSession()?.cancel(); this.scheduleSave(); }
  lassoCommit(): void { this.commitFloatSelection(); }
  lassoDuplicate(): void { this.duplicateFloatSelection(); }
  lassoCancel(): void { this.cancelFloatSelection(); }

  async exportPNG(): Promise<void> { return this.project.exportPNG(); }
  async exportProject(): Promise<void> { return this.project.exportProject(); }
  async importProject(file: File): Promise<void> { return this.project.importProject(file); }
  async exportSettings(): Promise<void> { return this.settings.exportFile(); }
  async importSettings(file: File): Promise<void> { return this.settings.importFile(file); }

  syncStore(): void {
    const ls = this.layerService;
    const metas: LayerMeta[] = ls.layers.map((l) => {
      const linkInfo = this.links.infoFor(l.id);
      return ({
      ...layerTypeProps(l),
      id: l.id,
      type: l.type,
      name: l.name,
      opacity: l.opacity,
      blend: l.blend,
      visible: l.visible,
      parentId: l.parentId,
      childIds: [...l.childIds],
      ...(l.parameterLink ? { parameterLink: structuredClone(l.parameterLink) } : { parameterLink: undefined }),
      linkSource: linkInfo.source,
      directLinkTargets: linkInfo.targets,
      compatibleLinkParameterIds: linkInfo.compatibleIds,
      version: ls.versions.get(l.id) ?? 0,
      canMergeDown: ls.canMergeLayerDown(l.id),
      canRemove: ls.canRemoveLayer(l.id),
      canTransferShape: ls.canTransferShape(l.id),
    });
    });
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
      selectionActive: this.activeFloat()?.phase === 'float',
      freeTransform: this.activeFloat()?.phase === 'float' && !!this.activeFloat()?.free,
    });
  }

  scheduleSave(): void { this.autosave.scheduleSave(); }

  /** @internal — tests call via cast */
  flushSave(): Promise<void> { return this.autosave.flushSave(); }
}
