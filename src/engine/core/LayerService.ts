import {ImageAsset} from '../image/ImageAsset';
import { adoptPixelLayout, scaleTextLayout } from '../physicalCoordinates';
import { scaleShape } from '../pageSpec';
import { scopeOwner, layerChildren } from '../layerTree';
import { rebuildScopeOwnership } from '../layer-types/scopes';
import { useStore } from '../../state/store';
import {
  cloneImageParams,
  fitImageParamsToSource,
  type LayerType,
  type ShapeParams,
  type TextParams,
} from '../../model';
import { getToolDescriptor } from '../../tools/registry';
import {
  type LayerLocation,
  type LocatedLayerSnapshot,
  type LayerProps,
  type LayerSnapshot,
  type TileLayerMergeOp,
  type LayerLinkOp,
} from '../history/historyTree';
import { extractSparseTiles } from '../history/tilePatch';
import {
  applyLayerProps,
  buildLayerSnapshot,
  hostWithProps,
  layerHandler,
  layerTypeHandler,
  layerTypeProps,
  restoreLayerFrom,
} from '../layer-types/registry';
import { shapeLayerName } from '../layer-types/shape';
import { textFrame } from '../layer-types/text';
import {
  createAdjustLayer,
  createCanvasLayer,
  createTransformLayer,
  createClipLayer,
  createImageLayer,
  createOutlineLayer,
  createRasterLayer,
  createShapeLayer,
  createTextLayer,
  type ImageLayer,
  type Layer,
  type RasterLayer,
  type ShapeLayer,
} from '../layers';
import { canReparent, closestRasterOrRoot, structuralLowerId } from '../layerTree';
import { placedImage } from '../image/frame';
import { isEmptyText, newText } from '../text/model';
import type { PaintEngine } from '../PaintEngine';
import { cloneShape, polygonFromWorldPoints, shapeCorners } from '../shapes';
import type { LayerParameterValue } from '../parameters/types';
import type { DirtyRect } from '../brush';

export interface PanelFrameLayerOptions {
  outlineColor: string;
  outlineWidthMm: number;
}

export interface SpeechBubbleLayerOptions {
  outlineColor: string;
  outlineWidthMm: number;
  textColor: string;
  fontId: string;
  fontSizePt: number;
  textFrame: { x: number; y: number; w: number; h: number };
}

/** Owns layer tree state and layer CRUD / tree mutation helpers. */
export class LayerService {
  layers: Layer[] = [];
  rootLayerIds: string[] = [];
  activeLayerId = '';
  versions = new Map<string, number>();
  /** 表示状態を含めず、マスクとしての見た目が変わったときだけ増える。 */
  maskVersions = new Map<string, number>();
  /** 種別ごとの自動命名カウンタ (`レイヤー 3` の連番) */
  nameCounters = new Map<LayerType, number>();

  constructor(private engine: PaintEngine) {}

  /** 種別ごとの連番を進めて既定のレイヤー名を作る */
  nextLayerName(type: LayerType): string {
    const index = (this.nameCounters.get(type) ?? 0) + 1;
    this.nameCounters.set(type, index);
    return layerTypeHandler(type).info.defaultName(index);
  }

  byId(id: string): Layer | null {
    const layer=this.layers.find(l=>l.id===id);
    return layer?this.engine.links.resolveLayer(layer):null;
  }

  rasterById(id: string): RasterLayer | null {
    const l = this.byId(id);
    return l && l.type === 'raster' ? l : null;
  }

  shapeById(id: string): ShapeLayer | null {
    const l = this.byId(id);
    return l && l.type === 'shape' ? l : null;
  }

  imageById(id: string): ImageLayer | null {
    const l = this.byId(id);
    return l && l.type === 'image' ? l : null;
  }

  siblingIds(parentId: string | null): string[] {
    if (parentId === null) return this.rootLayerIds;
    const canvas = this.byId(parentId);
    return canvas?.type === 'canvas' ? canvas.childIds : [];
  }

  scopeOf(id: string): string | null { return scopeOwner(this.layers, id); }

  locationOf(id: string): LayerLocation | null {
    const layer = this.byId(id);
    if (!layer) return null;
    const siblings = this.siblingIds(this.scopeOf(layer.id));
    const index = siblings.indexOf(id);
    return index < 0 ? null : { parentId: this.scopeOf(layer.id), index };
  }

  insertAt(id: string, location: LayerLocation): void {
    const layer = this.byId(id);
    if (!layer) return;
    const siblings = this.siblingIds(location.parentId);
    siblings.splice(Math.max(0, Math.min(location.index, siblings.length)), 0, id);
  }

  detachLayer(id: string): LayerLocation | null {
    const location = this.locationOf(id);
    if (!location) return null;
    this.siblingIds(location.parentId).splice(location.index, 1);
    return location;
  }

  descendantIds(id: string): string[] {
    const result: string[] = [];
    const visit = (layerId: string) => {
      const layer = this.byId(layerId);
      if (!layer) return;
      result.push(layerId);
      for (const child of layerChildren(layer)) visit(child);
    };
    visit(id);
    return result;
  }

  bumpLayer(id: string, rect?: DirtyRect): void {
    this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
    this.bumpMaskVersion(id);
    if (rect) this.engine.compositor.invalidateLayer(id, rect);
    else this.engine.requestRender();
  }

  bumpMaskVersion(id: string): void {
    this.maskVersions.set(id, (this.maskVersions.get(id) ?? 0) + 1);
    this.engine.compositor.invalidateMaskLayer(id);
  }

  snapshotLayer(l: Layer, withContent: boolean): LayerSnapshot {
    this.engine.links.resolveLayer(l);
    return buildLayerSnapshot(l, {
      artboard: this.engine.artboard,
      ppi: this.engine.getPageSpec().ppi,
      withContent,
    });
  }

  async restoreLayer(snap: LayerSnapshot, location?: LayerLocation): Promise<Layer | null> {
    const layer = await restoreLayerFrom(snap, { artboard: this.engine.artboard, ppi: this.engine.getPageSpec().ppi });
    if (!layer) return null;
    this.layers.push(layer);
    if (location) this.insertAt(layer.id, location);
    rebuildScopeOwnership(this.layers);
    this.bumpLayer(layer.id);
    return layer;
  }

  removeLayerInternal(id: string): void {
    this.engine.links.archiveRemoval(this.descendantIds(id));
    this.detachLayer(id);
    const ids = new Set(this.descendantIds(id));
    this.layers = this.layers.filter((l) => !ids.has(l.id));
  }

  removeLayerExact(id: string): void {
    this.engine.links.archiveRemoval([id]);
    this.detachLayer(id);
    this.layers = this.layers.filter((layer) => layer.id !== id);
  }

  async restoreEntries(entries: LocatedLayerSnapshot[]): Promise<void> {
    const ids = new Set(entries.map((entry) => entry.snapshot.id));
    for (const entry of entries) await this.restoreLayer(entry.snapshot);
    for (const entry of [...entries].sort((a, b) => a.location.index - b.location.index)) {
      if (!entry.location.parentId || !ids.has(entry.location.parentId)) {
        this.insertAt(entry.snapshot.id, entry.location);
      }
    }
  }

  fixActive(): void {
    if (this.byId(this.activeLayerId)) return;
    const raster = [...this.layers].reverse().find((l) => l.type === 'raster');
    this.activeLayerId = raster?.id ?? this.layers[this.layers.length - 1]?.id ?? '';
  }

  assignProps(l: Layer, p: LayerProps): void {
    const affectsMask = p.opacity !== undefined || p.state !== undefined;
    applyLayerProps(l, p);
    this.versions.set(l.id, (this.versions.get(l.id) ?? 0) + 1);
    if (affectsMask) this.bumpMaskVersion(l.id);
  }

  /** Authored mask IDs survive deletion; SceneQuery disables invalid references. */
  maskReferenceOps(_removedIds: Set<string>): { layerId: string; before: string[]; after: string[] }[] {
    return [];
  }

  detachMaskReferences(removedIds: Set<string>): { layerId: string; before: string[]; after: string[] }[] {
    const changes = this.maskReferenceOps(removedIds);
    for (const change of changes) {
      const layer = this.byId(change.layerId);
      if (layer) this.assignProps(layer, { state: { maskLayerIds: change.after } });
    }
    return changes;
  }

  mergeTarget(layer: Layer): RasterLayer | null {
    const targetId = structuralLowerId(layer, this.rootLayerIds, this.layers);
    return targetId ? this.rasterById(targetId) : null;
  }

  canRemoveLayer(id: string): boolean {
    if (!this.byId(id)) return false;
    const removed = new Set(this.descendantIds(id));
    return this.layers.some(layer => !removed.has(layer.id));
  }

  canMergeLayerDown(id = this.activeLayerId): boolean {
    const layer = this.byId(id);
    return !!layer && !!this.mergeTargetFor(layer);
  }

  private mergeTargetFor(layer: Layer): RasterLayer | null {
    if (!layerHandler(layer).renderer.effect) return this.mergeTarget(layer);
    if (layerChildren(layer).length) return null;
    const siblings = this.siblingIds(this.scopeOf(layer.id));
    if (siblings.indexOf(layer.id) !== 1) return null;
    return this.rasterById(siblings[0]);
  }

  canTransferShape(id = this.activeLayerId): boolean {
    const layer = this.byId(id);
    return !!layer
      && !!layerHandler(layer).capabilities.transferToRaster?.canTransfer(layer as never)
      && this.layers.some(target => target.type === 'raster' && this.scopeOf(target.id) === this.scopeOf(layer.id));
  }

  canAddToScope(scopeId: string | null): boolean {
    if (!this.engine.bins?.activeId || scopeId !== null || !this.rootLayerIds.length) return true;
    useStore.getState().set({toolNotice: 'ビンではキャンバス素材の内部にレイヤーを追加できます'});
    return false;
  }

  canMoveLayer(id: string, parentId: string | null): boolean {
    if (this.engine.bins?.activeId && (this.rootLayerIds.includes(id) || parentId === null)) return false;
    return canReparent(this.layers, id, parentId);
  }

  layerChildren(id: string): string[] {
    return [...layerChildren(this.byId(id))];
  }

  layerRootIds(): string[] {
    return [...this.rootLayerIds];
  }

  getLayerCanvas(id: string): HTMLCanvasElement | null {
    const l = this.byId(id);
    return l ? layerHandler(l).renderer.contentCanvas(l as never, this.engine.compositor.measureEnv()) : null;
  }

  getShape(id: string): ShapeParams | null {
    const layer = this.shapeById(id);
    return layer ? scaleShape(layer.state.shape, this.engine.getPageSpec().ppi / 25.4) : null;
  }

  getText(id: string): TextParams | null {
    const layer = this.byId(id);
    return layer?.type === 'text' ? scaleTextLayout(layer.state.text, this.engine.getPageSpec().ppi / 25.4) : null;
  }

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
    return this.engine.transforms.targets().some(target => {
      if (target.canvasId) return true;
      const layer = this.byId(target.id);
      return !!layer && (layer.type === 'raster' || layer.type === 'transform'
        || !!layerHandler(layer).capabilities.objectTransform);
    });
  }

  finishFloating(): void {
    this.engine.finishTextEditing();
    this.engine.activeSession()?.commit();
  }

  finishTextEditing(): boolean {
    this.engine.events.emit('textCommitRequest');
    const id = useStore.getState().textEditingId;
    if (!id) return false;
    useStore.getState().set({ textEditingId: null });
    this.engine.requestRender();
    const layer = this.byId(id);
    if (layer?.type !== 'text' || !isEmptyText(layer.state.text)) return false;
    const parent = this.byId(this.scopeOf(layer.id) ?? '');
    // A bubble owns an outline sibling; its empty text is an intentional editable placeholder.
    const bubblePlaceholder = parent?.type === 'canvas' && parent.childIds.some(childId => this.byId(childId)?.type === 'outline');
    if (bubblePlaceholder) return false;
    const location = this.locationOf(id);
    if (!location) return false;
    const snapshots = this.descendantIds(id).map(layerId => this.snapshotLayer(this.byId(layerId)!, true));
    this.removeLayerInternal(id);
    this.engine.history.push({ kind: 'layerRemove', location, snapshots }, '空の文字を削除');
    this.fixActive();
    this.engine.committed();
    return true;
  }

  updateText(id: string, before: TextParams, after: TextParams, preview = false): void {
    const factor = 25.4 / this.engine.getPageSpec().ppi;
    before = scaleTextLayout(before, factor); after = scaleTextLayout(after, factor);
    const layer = this.byId(id);
    if (this.engine.isBusy() || layer?.type !== 'text') return;
    const linkChange = !preview ? this.engine.links.detachChanged(
      layer,
      { ...layer, state: { ...layer.state, text: structuredClone(before) } },
      { ...layer, state: { ...layer.state, text: structuredClone(after) } },
    ) : null;
    layer.state.text = structuredClone(after);
    if (linkChange) layer.parameterLink = structuredClone(linkChange.after);
    this.bumpLayer(id);
    const contentBefore = { ...before, x: 0, y: 0, width: null, height: null };
    const contentAfter = { ...after, x: 0, y: 0, width: null, height: null };
    const frameOnlyPreview = preview && JSON.stringify(contentBefore) === JSON.stringify(contentAfter);
    if (!frameOnlyPreview) this.engine.syncTextRendersPublic();
    if (!preview && JSON.stringify(before) !== JSON.stringify(after)) {
      const propsOp = { kind: 'layerProps' as const, layerId: id, before: { state: { text: structuredClone(before) } }, after: { state: { text: structuredClone(after) } } };
      this.engine.history.push(linkChange ? { kind: 'batch', ops: [propsOp, {
        kind: 'layerLink',
        target: { document: this.engine.documentKey, layerId: id },
        before: linkChange.before,
        after: linkChange.after,
      }] } : propsOp, '文字を編集');
      this.engine.links.propagateFrom({ document: this.engine.documentKey, layerId: id });
      this.engine.committed();
    } else {
      if (preview) this.engine.links.propagateFrom({ document: this.engine.documentKey, layerId: id }, true);
      this.engine.syncStore();
    }
  }

  addTextLayer(text: TextParams): void {
    if (this.engine.isBusy()) return;
    this.finishFloating();
    const parentId = closestRasterOrRoot(this.layers, this.activeLayerId);
    const location = { parentId, index: this.siblingIds(parentId).length };
    const layer = createTextLayer('文字', text);
    adoptPixelLayout(layer, this.engine.getPageSpec().ppi);
    if (!this.canAddToScope(location.parentId)) return;
    this.layers.push(layer);
    this.insertAt(layer.id, location);
    this.activeLayerId = layer.id;
    this.engine.history.push({ kind: 'layerAdd', location, snapshot: this.snapshotLayer(layer, false) }, '文字を追加');
    useStore.getState().set({ textEditingId: layer.id });
    this.engine.committed();
  }

  textAt(x: number, y: number): string | null {
    const walk = (ids: string[]): string | null => {
      for (const id of [...ids].reverse()) {
        const layer = this.byId(id)!;

        if (layer.type !== 'text' || !layer.visible) continue;
        const frame = textFrame(layer, this.engine.compositor.textRenderer, this.engine.getPageSpec().ppi);
        const cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2, angle = -(layer.state.text.rotation ?? 0);
        const dx = x - cx, dy = y - cy;
        const localX = dx * Math.cos(angle) - dy * Math.sin(angle) + cx;
        const localY = dx * Math.sin(angle) + dy * Math.cos(angle) + cy;
        if (localX >= frame.x && localY >= frame.y && localX <= frame.x + frame.w && localY <= frame.y + frame.h) return id;
      }
      return null;
    };
    return walk(this.siblingIds(this.scopeOf(this.activeLayerId)));
  }

  textFrameSize(id: string): { width: number; height: number } | null {
    const layer = this.byId(id);
    if (layer?.type !== 'text') return null;
    const frame = textFrame(layer, this.engine.compositor.textRenderer, this.engine.getPageSpec().ppi);
    return { width: frame.w, height: frame.h };
  }

  editTextLayer(id: string): void {
    if (this.engine.isBusy() || this.byId(id)?.type !== 'text') return;
    this.setActiveLayer(id);
    useStore.getState().set({ textEditingId: id });
    this.engine.requestRender();
  }

  addCanvasLayer(): void { this.addScopeLayer(createCanvasLayer(this.nextLayerName('canvas')), 'キャンバスを追加'); }
  addTransformLayer(): void { this.addScopeLayer(createTransformLayer(this.nextLayerName('transform')), 'トランスフォームを追加'); }

  private addScopeLayer(layer: Layer, label: string): void {
    if (this.engine.isBusy()) return;
    this.finishFloating();
    const active = this.byId(this.activeLayerId);
    const current = this.locationOf(this.activeLayerId);
    const location = active?.type === 'canvas'
      ? { parentId: active.id, index: active.childIds.length }
      : current ? { ...current, index: current.index + 1 } : { parentId: null, index: this.rootLayerIds.length };
    if (!this.canAddToScope(location.parentId)) return;
    this.layers.push(layer); this.insertAt(layer.id, location); this.activeLayerId = layer.id;
    this.engine.history.push({ kind: 'layerAdd', location, snapshot: this.snapshotLayer(layer, false) }, label);
    this.engine.committed();
  }

  addRasterLayer(): void {
    if (this.engine.isBusy()) return;
    this.addScopeLayer(createRasterLayer(this.nextLayerName('raster'), this.engine.getPageSpec().ppi, undefined), 'レイヤー追加');
  }

  addAdjustLayer(): void {
    this.addScopeLayer(createAdjustLayer(this.nextLayerName('adjust')), '補正レイヤー追加');
  }

  addOutlineLayer(): void {
    this.addScopeLayer(createOutlineLayer(this.nextLayerName('outline')), '縁どりレイヤー追加');
  }

  addClipLayer(): void {
    this.addScopeLayer(createClipLayer(this.nextLayerName('clip')), 'クリップレイヤー追加');
  }

  addShapeLayer(shape: ShapeParams): void {
    if (this.engine.isBusy()) return;
    const parentId = closestRasterOrRoot(this.layers, this.activeLayerId);
    const siblings = this.siblingIds(parentId);
    const location: LayerLocation = { parentId, index: siblings.length };
    const layer = createShapeLayer(shapeLayerName(shape), shape);
    adoptPixelLayout(layer, this.engine.getPageSpec().ppi);
    if (!this.canAddToScope(location.parentId)) return;
    this.layers.push(layer);
    this.insertAt(layer.id, location);
    this.activeLayerId = layer.id;
    this.engine.history.push({ kind: 'layerAdd', location, snapshot: this.snapshotLayer(layer, false) }, '図形を追加');
    useStore.getState().pushColor(shape.color);
    this.engine.committed();
  }

  private generatedSelection() {
    const state = useStore.getState();
    return {
      activeLayerId: this.activeLayerId,
      selectedLayerIds: state.selectedLayerIds.length ? [...state.selectedLayerIds] : (this.activeLayerId ? [this.activeLayerId] : []),
      multiSelectMode: state.multiSelectMode,
    };
  }

  private addGeneratedTree(
    root: Layer,
    layers: Layer[],
    selectedId: string,
    label: string,
    textEditingId: string | null = null,
  ): void {
    const before = this.generatedSelection();
    const activeLocation = this.locationOf(this.activeLayerId);
    const rootLocation: LayerLocation = activeLocation
      ? { parentId: activeLocation.parentId, index: activeLocation.index + 1 }
      : { parentId: null, index: this.rootLayerIds.length };
    if (!this.canAddToScope(rootLocation.parentId)) return;
    for (const layer of layers) adoptPixelLayout(layer, this.engine.getPageSpec().ppi);
    this.layers.push(...layers);
    this.insertAt(root.id, rootLocation);
    for (const layer of layers) {
      this.versions.set(layer.id, 0);
      this.maskVersions.set(layer.id, 0);
    }
    this.activeLayerId = selectedId;
    const after = {
      activeLayerId: selectedId,
      selectedLayerIds: [selectedId],
      multiSelectMode: false,
    };
    const entries: LocatedLayerSnapshot[] = layers.map(layer => {
      const location = layer.id === root.id
        ? rootLocation
        : { parentId: this.scopeOf(layer.id), index: layerChildren(this.byId(this.scopeOf(layer.id) ?? '')).indexOf(layer.id) };
      return { location, snapshot: this.snapshotLayer(layer, false) };
    });
    useStore.getState().set({
      selectedLayerIds: [selectedId],
      multiSelectMode: false,
      textEditingId,
    });
    this.engine.history.push({
      kind: 'layerReplace',
      before: { rootIds: [], entries: [], selection: before },
      after: { rootIds: [root.id], entries, selection: after },
    }, label);
    this.engine.committed();
  }

  addPanelFrame(shape: ShapeParams, options: PanelFrameLayerOptions): void {
    if (this.engine.isBusy()) return;
    this.finishFloating();
    const root = createCanvasLayer('コマ');
    const maskShape = createShapeLayer('コマ形状', shape);
    const raster = createRasterLayer('コマ描画', this.engine.getPageSpec().ppi, undefined);
    const clip = createClipLayer('コマ内クリップ');
    const outline = createOutlineLayer('コマ枠');
    root.childIds = [maskShape.id, raster.id, clip.id, outline.id];
    clip.state.maskLayerIds = [maskShape.id];
    outline.state.outline = {
      ...outline.state.outline,
      color: options.outlineColor,
      widthMm: options.outlineWidthMm,
      cornerStyle: 'sharp',
    };
    this.addGeneratedTree(root, [root, maskShape, raster, clip, outline], raster.id, 'コマを追加');
    useStore.getState().pushColor(shape.color);
  }

  addSpeechBubble(bodyShape: ShapeParams, tailShape: ShapeParams | null, options: SpeechBubbleLayerOptions): void {
    if (this.engine.isBusy()) return;
    this.finishFloating();
    const root = createCanvasLayer('吹き出し');
    const body = createShapeLayer('本体', bodyShape);
    const tail = tailShape ? createShapeLayer('しっぽ', tailShape) : null;
    const outline = createOutlineLayer('吹き出し枠');
    const frame = options.textFrame;
    const text = createTextLayer('文字', newText(frame.x, frame.y, options.textColor, frame.w, frame.h, {
      fontId: options.fontId,
      sizePt: options.fontSizePt,
      direction: 'vertical',
      horizontalAlign: 'left',
      verticalAlign: 'top',
      lineHeight: 1.5,
    }));
    root.childIds = [body.id, ...(tail ? [tail.id] : []), outline.id, text.id];
    if (tail) {
      tail.parameterLink = {
        source: { document: this.engine.documentKey, layerId: body.id },
        sourceNameHint: body.name,
        sourcePageIndexHint: Math.max(0, this.engine.pages.pageOrder.indexOf(this.engine.pages.activePageId)),
        linkedParameterIds: ['appearance.color'],
        fallbackValues: { 'appearance.color': bodyShape.color },
      };
    }
    outline.state.outline = {
      ...outline.state.outline,
      color: options.outlineColor,
      widthMm: options.outlineWidthMm,
      cornerStyle: bodyShape.kind === 'rect' ? 'sharp' : 'round',
    };
    this.addGeneratedTree(root, [root, body, ...(tail ? [tail] : []), outline, text], text.id, '吹き出しを追加', text.id);
    useStore.getState().pushColor(bodyShape.color);
    useStore.getState().pushColor(options.textColor);
  }

  addImageLayer(canvas: HTMLCanvasElement, x: number, y: number, maxWidth: number, maxHeight: number): void {
    if (this.engine.isBusy()) return;
    const parentId = closestRasterOrRoot(this.layers, this.activeLayerId);
    const siblings = this.siblingIds(parentId);
    const location: LayerLocation = { parentId, index: siblings.length };
    const layer = createImageLayer(
      this.nextLayerName('image'),
      canvas,
      placedImage(canvas, x, y, maxWidth, maxHeight),
    );
    if (!this.canAddToScope(location.parentId)) return;
    adoptPixelLayout(layer, this.engine.getPageSpec().ppi);
    this.layers.push(layer);
    this.insertAt(layer.id, location);
    this.activeLayerId = layer.id;
    this.engine.history.push({ kind: 'layerAdd', location, snapshot: this.snapshotLayer(layer, true) }, '画像を追加');
    this.engine.committed();
  }

  moveLayerAsTopChild(id: string, parentId: string): void {
    const parent = this.byId(parentId);
    if (parent && this.canMoveLayer(id, parentId)) this.moveLayer(id, { parentId, index: layerChildren(parent).length });
  }

  moveLayerOut(id: string): void {
    const layer = this.byId(id);
    const owner = this.scopeOf(id);
    if (!layer || !owner) return;
    const parentLocation = this.locationOf(owner);
    if (parentLocation) this.moveLayer(id, { parentId: parentLocation.parentId, index: parentLocation.index + 1 });
  }

  removeLayer(id: string): void {
    if (this.engine.isBusy()) return;
    this.finishFloating();
    const location = this.locationOf(id);
    if (!location) return;
    const ids = this.descendantIds(id);
    const removeIds = new Set(ids);
    if (!this.canRemoveLayer(id)) return;
    const snapshots = ids.map((layerId) => this.snapshotLayer(this.byId(layerId)!, true));
    const maskOps = this.detachMaskReferences(removeIds).map(change => ({
      kind: 'layerProps' as const,
      layerId: change.layerId,
      before: { state: { maskLayerIds: change.before } },
      after: { state: { maskLayerIds: change.after } },
    }));
    const structureOp = this.engine.canvases.suppress(id, location.parentId);
    this.removeLayerInternal(id);
    const removeOp = { kind: 'layerRemove' as const, location, snapshots };
    this.engine.history.push({kind: 'batch', ops: [...(structureOp ? [structureOp] : []), removeOp, ...maskOps]}, 'レイヤー削除');
    this.fixActive();
    this.engine.committed();
  }

  moveLayer(id: string, to: LayerLocation): boolean {
    if (this.engine.isBusy()) return false;
    const from = this.locationOf(id);
    if (!from || !this.canMoveLayer(id, to.parentId)) return false;
    const adjusted = { ...to };
    if (from.parentId === to.parentId && from.index < to.index) adjusted.index--;
    if (from.parentId === adjusted.parentId && from.index === adjusted.index) return false;
    this.detachLayer(id);
    this.insertAt(id, adjusted);
    const structureOps = this.engine.canvases.move(id, from, adjusted);
    this.engine.history.push({kind: 'batch', ops: [{kind: 'layerMove', layerId: id, from, to: adjusted}, ...structureOps]}, 'レイヤー並べ替え');
    this.engine.committed();
    return true;
  }

  bakeAndMerge(upper: Layer, lower: RasterLayer, label: string, beforeActiveId: string): void {
    const before = lower.runtime.surface.snapshot();
    const removedLocation = this.locationOf(upper.id);
    if (!removedLocation) return;
    const removedSnapshot = this.snapshotLayer(upper, true);
    const maskChanges = this.detachMaskReferences(new Set(this.descendantIds(upper.id)));
    const effectMerge = !!layerHandler(upper).renderer.effect;
    const targetProps = effectMerge
      ? { before: { opacity: lower.opacity, blend: lower.blend }, after: { opacity: 1, blend: 'source-over' as const } }
      : undefined;
    this.engine.compositor.bakeLayerOnto(lower, upper);
    if (targetProps) this.assignProps(lower, targetProps.after);
    this.removeLayerInternal(upper.id);
    this.activeLayerId = lower.id;
    this.bumpLayer(lower.id);
    const extraction = extractSparseTiles(before, lower.runtime.surface.snapshot());
    const op: TileLayerMergeOp = {
      kind: 'layerMerge',
      format: 'tiles-v1',
      targetLayerId: lower.id,
      removed: { location: removedLocation, snapshot: removedSnapshot },
      tiles: [],
      beforeActiveId,
      afterActiveId: lower.id,
      targetProps,
      maskChanges,
    };
    const node = this.engine.history.push(op, label);
    node.ready = extraction.ready.then((tiles) => {
      op.tiles = tiles;
    });
    void node.ready.then(() => this.engine.scheduleStorageRefresh());
    this.engine.committed();
  }

  async mergeLayerDown(id = this.activeLayerId): Promise<void> {
    if (this.engine.isBusy()) return;
    this.finishFloating();
    const upper = this.byId(id);
    if (!upper) return;
    const lower = this.mergeTargetFor(upper);
    if (!lower) return;

    this.engine.setBusy(true);
    try {
      await this.engine.readyToRender();
      this.bakeAndMerge(upper, lower, '下のレイヤーと統合', this.activeLayerId);
    } finally {
      this.engine.setBusy(false);
    }
  }

  transferShapeLayer(targetId: string): void {
    if (this.engine.isBusy()) return;
    if (!this.canTransferShape()) return;
    const layer = this.byId(this.activeLayerId)!;
    const target = this.rasterById(targetId);
    if (!target || this.scopeOf(target.id) !== this.scopeOf(layer.id)) return;
    this.bakeAndMerge(layer, target, layer.type === 'image' ? '画像を転写' : '図形を転写', layer.id);
  }

  async applyLayerContent(snapshot: LayerSnapshot): Promise<void> {
    const current = this.byId(snapshot.id);
    if (!current || current.type !== snapshot.type) return;
    const restored = await restoreLayerFrom(snapshot, { artboard: this.engine.artboard, ppi: this.engine.getPageSpec().ppi });
    if (!restored || restored.type !== current.type) return;
    if (current.type === 'raster' && restored.type === 'raster') {
      current.runtime = restored.runtime;
      if (current.parameterLink) current.parameterLink.linkedContent = snapshot.common.parameterLink?.linkedContent ?? false;
    } else if (current.type === 'image' && restored.type === 'image') {
      if (current.parameterLink) current.parameterLink.linkedContent = snapshot.common.parameterLink?.linkedContent ?? false;
      current.runtime = restored.runtime;
      current.state = restored.state;
    } else {
      this.assignProps(current, layerTypeProps(restored));
    }
    this.bumpLayer(current.id);
  }

  replaceImageContent(id: string, canvas: HTMLCanvasElement): void {
    if (this.engine.isBusy()) return;
    const layer = this.imageById(id);
    if (!layer || canvas.width <= 0 || canvas.height <= 0) return;
    const before = this.snapshotLayer(layer, true);
    if (layer.parameterLink) layer.parameterLink.linkedContent = false;
    this.engine.links.authoredContent(layer);
    layer.runtime = {asset:new ImageAsset(canvas)};
    this.bumpLayer(layer.id);
    const after = this.snapshotLayer(layer, true);
    this.engine.history.push({ kind: 'layerContent', layerId: layer.id, before, after }, '画像を差し替え');
    this.engine.committed();
  }

  fitImageAspect(id: string): void {
    if (this.engine.isBusy()) return;
    const layer = this.imageById(id);
    if (!layer) return;
    const afterImage = fitImageParamsToSource(layer.state.placement, layer.runtime.asset.width, layer.runtime.asset.height);
    if (afterImage.width === layer.state.placement.width && afterImage.height === layer.state.placement.height) return;
    this.commitLayerProps(
      id,
      { state: { placement: cloneImageParams(layer.state.placement) } },
      { state: { placement: afterImage } },
      '比率を画像に合わせる',
    );
  }

  setActiveLayer(id: string): void {
    if (this.engine.isBusy() || !this.byId(id)) return;
    const state = useStore.getState();
    state.set({ shortcutTarget: { type: 'layer', id } });
    if (state.multiSelectMode && this.scopeOf(id) !== this.scopeOf(this.activeLayerId)) {
      this.finishFloating(); this.activeLayerId = id;
      state.set({ multiSelectMode: false, selectedLayerIds: [id] });
      this.engine.syncStore(); this.engine.scheduleSave(); this.engine.notifyLayerSelectionChange(); return;
    }
    if (state.multiSelectMode) {
      const selected = new Set(state.selectedLayerIds);
      const removing = selected.has(id);
      if (removing) selected.delete(id); else selected.add(id);
      if (selected.size === 0) selected.add(id);
      const selectedLayerIds = [...selected];
      if (selectedLayerIds.length <= 1) {
        this.activeLayerId = selectedLayerIds[0]!;
        state.set({ multiSelectMode: false, selectedLayerIds, shortcutTarget: { type: 'layer', id: this.activeLayerId } });
      } else {
        this.activeLayerId = removing ? selectedLayerIds.at(-1)! : id;
        state.set({ selectedLayerIds, shortcutTarget: { type: 'layer', id: this.activeLayerId } });
      }
      this.engine.syncStore();
      this.engine.shapeEdit.refreshVertexState();
      this.engine.scheduleSave();
      this.engine.notifyLayerSelectionChange();
      return;
    }
    if (id === this.activeLayerId) return;
    this.finishFloating();
    this.activeLayerId = id;
    this.engine.requestOverlayRender();
    this.engine.syncStore();
    this.engine.shapeEdit.refreshVertexState();
    this.engine.scheduleSave();
    this.engine.notifyLayerSelectionChange();
  }

  previewLayerProps(id: string, props: LayerProps): void {
    if (this.engine.isBusy()) return;
    const l = this.byId(id);
    if (!l) return;
    this.assignProps(l, props);
    this.engine.links.propagateFrom({ document: this.engine.documentKey, layerId: id }, true);
    this.engine.requestRender();
    this.engine.syncStore();
  }

  linkOpForUserChange(layer: Layer, before: LayerProps, after: LayerProps, preserveIfSourceMatches = false): LayerLinkOp | null {
    const change = this.engine.links.detachChanged(
      layer,
      hostWithProps(layer, before),
      hostWithProps(layer, after),
      preserveIfSourceMatches,
    );
    if (!change) return null;
    this.assignProps(layer, { parameterLink: change.after });
    return {
      kind: 'layerLink',
      target: { document: this.engine.documentKey, layerId: layer.id },
      before: change.before,
      after: change.after,
    };
  }

  commitLayerProps(id: string, before: LayerProps, after: LayerProps, label: string): void {
    if (this.engine.isBusy()) return;
    this.engine.events.emit('textCommitRequest');
    const l = this.byId(id);
    if (!l) return;
    this.assignProps(l, after);
    const linkOp = this.linkOpForUserChange(l, before, after);
    const propsOp = { kind: 'layerProps' as const, layerId: id, before, after };
    this.engine.history.push(linkOp ? {
      kind: 'batch',
      ops: [propsOp, linkOp],
    } : propsOp, label);
    this.engine.links.propagateFrom({ document: this.engine.documentKey, layerId: id });
    this.engine.committed();
  }

  updateShapeParams(id: string, before: ShapeParams, after: ShapeParams, preview = false): void {
    const factor = 25.4 / this.engine.getPageSpec().ppi;
    before = scaleShape(before, factor); after = scaleShape(after, factor);
    if (preview) this.previewLayerProps(id, { state: { shape: after } });
    else this.commitLayerProps(id, { state: { shape: before } }, { state: { shape: after } }, '図形を編集');
  }

  convertRectToPolygon(id = this.activeLayerId): void {
    if (this.engine.isBusy()) return;
    const layer = this.shapeById(id);
    if (!layer || layer.state.shape.kind !== 'rect') return;
    const beforeShape = cloneShape(layer.state.shape);
    const beforeName = layer.name;
    const center = { x: layer.state.shape.x + layer.state.shape.width / 2, y: layer.state.shape.y + layer.state.shape.height / 2 };
    const world = shapeCorners(layer.state.shape);
    const polygon = polygonFromWorldPoints(world, layer.state.shape);
    polygon.cx = center.x; polygon.cy = center.y;
    polygon.rotation = 0;
    polygon.points = world.map(point => ({ x: point.x - center.x, y: point.y - center.y }));
    this.assignProps(layer, { state: { shape: polygon } });
    if (layer.name === '四角形') layer.name = '多角形';
    const propsOp = {
      kind: 'layerProps', layerId: layer.id,
      before: { state: { shape: beforeShape }, name: beforeName },
      after: { state: { shape: cloneShape(layer.state.shape) }, name: layer.name },
    } as const;
    const linkOp = this.linkOpForUserChange(layer, propsOp.before, propsOp.after);
    const downstreamLinkOps = this.engine.links.propagateFrom({ document: this.engine.documentKey, layerId: layer.id });
    const operations = [propsOp, ...(linkOp ? [linkOp] : []), ...downstreamLinkOps];
    this.engine.history.push(operations.length > 1 ? { kind: 'batch', ops: operations } : propsOp, '多角形に変換');
    this.engine.committed();
  }

  renameLayer(id: string, name: string): boolean {
    const layer = this.byId(id);
    if (!layer || !name.trim()) return false;
    if (layer.name === name) return true;
    this.commitLayerProps(id, { name: layer.name }, { name }, 'レイヤー名を変更');
    return true;
  }

  beginMultiSelect(id: string): void {
    const layer = this.byId(id);
    if (!layer) return;
    const st = useStore.getState();
    const previous = st.selectedLayerIds.length ? st.selectedLayerIds : [this.activeLayerId];
    const selected = [...previous.filter(existing => this.scopeOf(existing) === this.scopeOf(layer.id)), ...(!previous.includes(id) ? [id] : [])];
    this.activeLayerId = selected[0] ?? id;
    this.applyMultiSelection(selected);
  }

  exitMultiSelect(): void {
    const st = useStore.getState();
    st.set({ multiSelectMode: false, selectedLayerIds: this.activeLayerId ? [this.activeLayerId] : [] });
    this.engine.syncStore();
    this.engine.scheduleSave();
    this.engine.notifyLayerSelectionChange();
  }

  selectMembers(selected:string[]):void { this.applyMultiSelection(selected); }

  private applyMultiSelection(selected: string[]): void {
    const ids = [...new Set(selected.filter(id => !!this.byId(id)))];
    if (!ids.length) return;
    const st = useStore.getState();
    if (!ids.includes(this.activeLayerId)) this.activeLayerId = ids[0]!;
    if (!getToolDescriptor(st.tool ?? '')?.capabilities.multiSelect) st.deactivateTool();
    st.set({ multiSelectMode: true, selectedLayerIds: ids, shortcutTarget: { type: 'layer', id: this.activeLayerId } });
    this.engine.syncStore();
    this.engine.scheduleSave();
    this.engine.notifyLayerSelectionChange();
  }

  commitSelectedLayerProps(before: LayerProps, after: LayerProps, label: string): void {
    const st = useStore.getState();
    const ids = st.multiSelectMode ? st.selectedLayerIds : [this.activeLayerId];
    const ops: import('../history/historyTree').AtomicOp[] = ids.flatMap(id => {
      const layer = this.byId(id);
      if (!layer) return [];
      const current: LayerProps = {
        opacity: layer.opacity, visible: layer.visible, blend: layer.blend,
        ...layerTypeProps(layer),
      };
      const op = { kind: 'layerProps' as const, layerId: id, before: { ...current, ...before }, after };
      this.assignProps(layer, after);
      const linkOp = this.linkOpForUserChange(layer, op.before, after);
      this.engine.links.propagateFrom({ document: this.engine.documentKey, layerId: id });
      return linkOp ? [op, linkOp] : [op];
    });
    if (!ops.length) return;
    this.engine.history.push(ops.length === 1 ? ops[0] : { kind: 'batch', ops }, label);
    this.engine.committed();
  }

  previewSelectedLayerProps(props: LayerProps): void {
    const state = useStore.getState();
    for (const id of state.selectedLayerIds) {
      const layer = this.byId(id);
      if (layer) {
        this.assignProps(layer, props);
        this.engine.links.propagateFrom({ document: this.engine.documentKey, layerId: id }, true);
      }
    }
    this.engine.requestRender();
    this.engine.syncStore();
  }

  updateSelectedShapes(update: (shape: ShapeParams) => ShapeParams): void {
    const ops: import('../history/historyTree').AtomicOp[] = useStore.getState().selectedLayerIds.flatMap(layerId => {
      const layer = this.byId(layerId);
      if (layer?.type !== 'shape') return [];
      const before = cloneShape(layer.state.shape);
      const after = update(cloneShape(before));
      if (JSON.stringify(before) === JSON.stringify(after)) return [];
      layer.state.shape = after;
      this.bumpLayer(layerId);
      const propsOp = { kind: 'layerProps' as const, layerId, before: { state: { shape: before } }, after: { state: { shape: after } } };
      const linkOp = this.linkOpForUserChange(layer, propsOp.before, propsOp.after);
      this.engine.links.propagateFrom({ document: this.engine.documentKey, layerId });
      return linkOp ? [propsOp, linkOp] : [propsOp];
    });
    if (!ops.length) return;
    this.engine.history.push({ kind: 'batch', ops }, '図形の共通設定');
    this.engine.committed();
  }

  updateSelectedParameter(key: string, value: LayerParameterValue): void {
    this.engine.parameters.commit(key, value, key === 'snapEnabled' ? 'スナップを変更' : key === 'constrainAspect' ? '比率の維持を変更' : '共通パラメータを変更');
  }

  previewSelectedParameter(key: string, value: LayerParameterValue): void {
    this.engine.parameters.preview(key, value);
  }

  commitSelectedParameterPreview(key: string, beforeValue: LayerParameterValue, value: LayerParameterValue): void {
    this.engine.parameters.commitRange(key, beforeValue, value);
  }

  commitSelectedLayerOpacity(beforeById: Record<string, number>, opacity: number): void {
    const changes = Object.entries(beforeById).flatMap(([layerId, before]) => {
      const layer = this.byId(layerId);
      if (!layer || before === opacity) return [];
      return [{ layer, layerId, before: { opacity: before }, after: { opacity } }];
    });
    for (const change of changes) this.assignProps(change.layer, change.after);
    const ops: import('../history/historyTree').AtomicOp[] = changes.flatMap(({ layer, layerId, before, after }) => {
      const propsOp = { kind: 'layerProps' as const, layerId, before, after };
      const linkOp = this.linkOpForUserChange(layer, before, after, true);
      return linkOp ? [propsOp, linkOp] : [propsOp];
    });
    if (!ops.length) return;
    this.engine.history.push(ops.length === 1 ? ops[0] : { kind: 'batch', ops }, '複数レイヤーの不透明度');
    for (const { layerId } of changes) this.engine.links.propagateFrom({ document: this.engine.documentKey, layerId });
    this.engine.committed();
  }

  resetCountersFromLayers(): void {
    this.nameCounters = new Map();
    for (const layer of this.layers) {
      this.nameCounters.set(layer.type, (this.nameCounters.get(layer.type) ?? 0) + 1);
    }
  }

  replaceTree(layers: Layer[], rootLayerIds: string[], activeLayerId: string): void {
    this.layers = layers;
    this.rootLayerIds = rootLayerIds;
    this.activeLayerId = activeLayerId;
  }

  clearVersions(): void {
    this.versions.clear();
    this.maskVersions.clear();
    this.engine.compositor.clearCaches();
  }
}
