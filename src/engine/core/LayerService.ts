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
import { extractTiles } from '../history/tilePatch';
import {
  applyLayerProps,
  buildLayerSnapshot,
  hostWithProps,
  layerHandler,
  layerTypeHandler,
  layerTypeProps,
  restoreLayerFrom,
} from '../layer-types/registry';
import { layerMaskIds } from '../layer-types/definition';
import { shapeLayerName } from '../layer-types/shape';
import { textFrame } from '../layer-types/text';
import {
  createAdjustLayer,
  createClipLayer,
  createImageLayer,
  createOutlineLayer,
  createRasterLayer,
  createShapeLayer,
  createTextLayer,
  ensureRasterSurface,
  markRasterContent,
  makeCanvas,
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
    return this.layers.find((l) => l.id === id) ?? null;
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
    return this.byId(parentId)?.childIds ?? [];
  }

  locationOf(id: string): LayerLocation | null {
    const layer = this.byId(id);
    if (!layer) return null;
    const siblings = this.siblingIds(layer.parentId);
    const index = siblings.indexOf(id);
    return index < 0 ? null : { parentId: layer.parentId, index };
  }

  insertAt(id: string, location: LayerLocation): void {
    const layer = this.byId(id);
    if (!layer) return;
    layer.parentId = location.parentId;
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
      for (const child of layer.childIds) visit(child);
    };
    visit(id);
    return result;
  }

  bumpLayer(id: string, rect?: DirtyRect): void {
    const raster = this.rasterById(id);
    if (raster && rect) markRasterContent(raster, {
      x: rect.minX, y: rect.minY, w: rect.maxX - rect.minX, h: rect.maxY - rect.minY,
    });
    this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
    this.bumpMaskVersion(id);
    if (rect) this.engine.compositor.invalidateLayer(id, rect);
    else this.engine.requestRender();
  }

  bumpMaskVersion(id: string): void {
    this.maskVersions.set(id, (this.maskVersions.get(id) ?? 0) + 1);
    this.engine.compositor.invalidateMaskLayer(id);
  }

  snapshotLayer(l: Layer, withContent: boolean, keepCanvas = false): LayerSnapshot {
    return buildLayerSnapshot(l, {
      artboard: this.engine.artboard,
      withContent,
      keepCanvas,
      onEncoded: () => this.engine.scheduleStorageRefresh(),
    });
  }

  async restoreLayer(snap: LayerSnapshot, location?: LayerLocation): Promise<Layer | null> {
    const layer = await restoreLayerFrom(snap, { artboard: this.engine.artboard });
    if (!layer) return null;
    this.layers.push(layer);
    if (location) this.insertAt(layer.id, location);
    this.bumpLayer(layer.id);
    return layer;
  }

  removeLayerInternal(id: string): void {
    this.detachLayer(id);
    const ids = new Set(this.descendantIds(id));
    this.layers = this.layers.filter((l) => !ids.has(l.id));
  }

  removeLayerExact(id: string): void {
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

  /** 削除されるレイヤーを参照しているマスク設定を外す */
  maskReferenceOps(removedIds: Set<string>): { layerId: string; before: string[]; after: string[] }[] {
    return this.layers.flatMap(layer => {
      const before = layerMaskIds(layer.state);
      if (!before || removedIds.has(layer.id) || !before.some(id => removedIds.has(id))) return [];
      return [{ layerId: layer.id, before, after: before.filter(id => !removedIds.has(id)) }];
    });
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
    return this.layers.some(l => l.type === 'raster' && !removed.has(l.id));
  }

  canMergeLayerDown(id = this.activeLayerId): boolean {
    const layer = this.byId(id);
    return !!layer && !!this.mergeTargetFor(layer);
  }

  private mergeTargetFor(layer: Layer): RasterLayer | null {
    if (!layerHandler(layer).renderer.effect) return this.mergeTarget(layer);
    if (layer.childIds.length) return null;
    if (layer.parentId) {
      const parent = this.rasterById(layer.parentId);
      return parent?.childIds.length === 1 && parent.childIds[0] === layer.id ? parent : null;
    }
    const index = this.rootLayerIds.indexOf(layer.id);
    if (index !== 1) return null;
    const target = this.rasterById(this.rootLayerIds[0]);
    return target && target.childIds.length === 0 ? target : null;
  }

  canTransferShape(id = this.activeLayerId): boolean {
    const layer = this.byId(id);
    return !!layer
      && !!layerHandler(layer).capabilities.transferToRaster?.canTransfer(layer as never)
      && !!this.rasterById(layer.parentId!);
  }

  canMoveLayer(id: string, parentId: string | null): boolean {
    return canReparent(this.layers, id, parentId);
  }

  layerChildren(id: string): string[] {
    return [...(this.byId(id)?.childIds ?? [])];
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
    return layer ? cloneShape(layer.state.shape) : null;
  }

  getText(id: string): TextParams | null {
    const layer = this.byId(id);
    return layer?.type === 'text' ? structuredClone(layer.state.text) : null;
  }

  activeRaster(): RasterLayer | null {
    const l = this.byId(this.activeLayerId);
    return l && l.type === 'raster' && l.visible ? ensureRasterSurface(l) : null;
  }

  selectedRasters(): RasterLayer[] {
    const state = useStore.getState();
    const ids = state.multiSelectMode ? new Set(state.selectedLayerIds) : new Set([this.activeLayerId]);
    return this.layers.filter((layer): layer is RasterLayer => layer.type === 'raster' && layer.visible && ids.has(layer.id)).map(ensureRasterSurface);
  }

  hasSelectedObjects(): boolean {
    const ids = new Set(useStore.getState().selectedLayerIds);
    return this.layers.some(layer => ids.has(layer.id) && !!layerHandler(layer).capabilities.objectTransform);
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
    if (layer?.type !== 'text' || layer.childIds.length > 0 || !isEmptyText(layer.state.text)) return false;
    const parent = layer.parentId ? this.byId(layer.parentId) : null;
    // A bubble owns an outline sibling; its empty text is an intentional editable placeholder.
    const bubblePlaceholder = parent?.type === 'shape' && parent.childIds.some(childId => this.byId(childId)?.type === 'outline');
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
        target: { pageId: this.engine.pages.activePageId, layerId: id },
        before: linkChange.before,
        after: linkChange.after,
      }] } : propsOp, '文字を編集');
      this.engine.links.propagateFrom({ pageId: this.engine.pages.activePageId, layerId: id });
      this.engine.committed();
    } else {
      if (preview) this.engine.links.propagateFrom({ pageId: this.engine.pages.activePageId, layerId: id }, true);
      this.engine.syncStore();
    }
  }

  addTextLayer(text: TextParams): void {
    if (this.engine.isBusy()) return;
    this.finishFloating();
    const parentId = closestRasterOrRoot(this.layers, this.activeLayerId);
    const location = { parentId, index: this.siblingIds(parentId).length };
    const layer = createTextLayer('文字', text);
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
        const child = walk(layer.childIds);
        if (child) return child;
        if (layer.type !== 'text' || !layer.visible) continue;
        const frame = textFrame(layer, this.engine.compositor.textRenderer);
        const cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2, angle = -(layer.state.text.rotation ?? 0);
        const dx = x - cx, dy = y - cy;
        const localX = dx * Math.cos(angle) - dy * Math.sin(angle) + cx;
        const localY = dx * Math.sin(angle) + dy * Math.cos(angle) + cy;
        if (localX >= frame.x && localY >= frame.y && localX <= frame.x + frame.w && localY <= frame.y + frame.h) return id;
      }
      return null;
    };
    return walk(this.rootLayerIds);
  }

  textFrameSize(id: string): { width: number; height: number } | null {
    const layer = this.byId(id);
    if (layer?.type !== 'text') return null;
    const frame = textFrame(layer, this.engine.compositor.textRenderer);
    return { width: frame.w, height: frame.h };
  }

  editTextLayer(id: string): void {
    if (this.engine.isBusy() || this.byId(id)?.type !== 'text') return;
    this.setActiveLayer(id);
    useStore.getState().set({ textEditingId: id });
    this.engine.requestRender();
  }

  addRasterLayer(): void {
    if (this.engine.isBusy()) return;
    this.finishFloating();
    const activeLocation = this.locationOf(this.activeLayerId);
    const location = activeLocation
      ? { ...activeLocation, index: activeLocation.index + 1 }
      : { parentId: null, index: this.rootLayerIds.length };
    const layer = createRasterLayer(this.nextLayerName('raster'), this.engine.artboard.w, this.engine.artboard.h);
    this.layers.push(layer);
    this.insertAt(layer.id, location);
    this.activeLayerId = layer.id;
    this.engine.history.push(
      { kind: 'layerAdd', location, snapshot: this.snapshotLayer(layer, false) },
      'レイヤー追加',
    );
    this.engine.committed();
  }

  addAdjustLayer(): void {
    if (this.engine.isBusy()) return;
    this.finishFloating();
    const activeLocation = this.locationOf(this.activeLayerId);
    const location = activeLocation
      ? { ...activeLocation, index: activeLocation.index + 1 }
      : { parentId: null, index: this.rootLayerIds.length };
    const layer = createAdjustLayer(this.nextLayerName('adjust'));
    this.layers.push(layer);
    this.insertAt(layer.id, location);
    this.activeLayerId = layer.id;
    this.engine.history.push(
      { kind: 'layerAdd', location, snapshot: this.snapshotLayer(layer, false) },
      '補正レイヤー追加',
    );
    this.engine.committed();
  }

  addOutlineLayer(): void {
    if (this.engine.isBusy()) return;
    this.finishFloating();
    const activeLocation = this.locationOf(this.activeLayerId);
    const location = activeLocation
      ? { ...activeLocation, index: activeLocation.index + 1 }
      : { parentId: null, index: this.rootLayerIds.length };
    const layer = createOutlineLayer(this.nextLayerName('outline'));
    this.layers.push(layer);
    this.insertAt(layer.id, location);
    this.activeLayerId = layer.id;
    this.engine.history.push(
      { kind: 'layerAdd', location, snapshot: this.snapshotLayer(layer, false) },
      '縁どりレイヤー追加',
    );
    this.engine.committed();
  }

  addClipLayer(): void {
    if (this.engine.isBusy()) return;
    this.finishFloating();
    const activeLocation = this.locationOf(this.activeLayerId);
    const location = activeLocation
      ? { ...activeLocation, index: activeLocation.index + 1 }
      : { parentId: null, index: this.rootLayerIds.length };
    const layer = createClipLayer(this.nextLayerName('clip'));
    this.layers.push(layer);
    this.insertAt(layer.id, location);
    this.activeLayerId = layer.id;
    this.engine.history.push(
      { kind: 'layerAdd', location, snapshot: this.snapshotLayer(layer, false) },
      'クリップレイヤー追加',
    );
    this.engine.committed();
  }

  addShapeLayer(shape: ShapeParams): void {
    if (this.engine.isBusy()) return;
    const parentId = closestRasterOrRoot(this.layers, this.activeLayerId);
    const siblings = this.siblingIds(parentId);
    const location: LayerLocation = { parentId, index: siblings.length };
    const layer = createShapeLayer(shapeLayerName(shape), shape);
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
    root.parentId = rootLocation.parentId;
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
        : { parentId: layer.parentId, index: this.byId(layer.parentId ?? '')?.childIds.indexOf(layer.id) ?? 0 };
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
    const root = createShapeLayer('コマ', shape);
    const raster = createRasterLayer('コマ描画', this.engine.artboard.w, this.engine.artboard.h, undefined, true);
    const clip = createClipLayer('コマ内クリップ');
    const outline = createOutlineLayer('コマ枠');
    root.childIds = [raster.id, clip.id];
    raster.parentId = root.id;
    clip.parentId = root.id;
    clip.childIds = [outline.id];
    clip.state.maskLayerIds = [root.id];
    outline.parentId = clip.id;
    outline.state.outline = {
      ...outline.state.outline,
      color: options.outlineColor,
      widthMm: options.outlineWidthMm,
      cornerStyle: 'sharp',
    };
    this.addGeneratedTree(root, [root, raster, clip, outline], raster.id, 'コマを追加');
    useStore.getState().pushColor(shape.color);
  }

  addSpeechBubble(bodyShape: ShapeParams, tailShape: ShapeParams | null, options: SpeechBubbleLayerOptions): void {
    if (this.engine.isBusy()) return;
    this.finishFloating();
    const body = createShapeLayer('吹き出し', bodyShape);
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
    body.childIds = [...(tail ? [tail.id] : []), outline.id, text.id];
    if (tail) {
      tail.parentId = body.id;
      tail.parameterLink = {
        source: { pageId: this.engine.pages.activePageId, layerId: body.id },
        sourceNameHint: body.name,
        sourcePageIndexHint: Math.max(0, this.engine.pages.pageOrder.indexOf(this.engine.pages.activePageId)),
        linkedParameterIds: ['appearance.color'],
        fallbackValues: { 'appearance.color': bodyShape.color },
      };
    }
    outline.parentId = body.id;
    outline.state.outline = {
      ...outline.state.outline,
      color: options.outlineColor,
      widthMm: options.outlineWidthMm,
      cornerStyle: bodyShape.kind === 'rect' ? 'sharp' : 'round',
    };
    text.parentId = body.id;
    this.addGeneratedTree(body, [body, ...(tail ? [tail] : []), outline, text], text.id, '吹き出しを追加', text.id);
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
    this.layers.push(layer);
    this.insertAt(layer.id, location);
    this.activeLayerId = layer.id;
    this.engine.history.push({ kind: 'layerAdd', location, snapshot: this.snapshotLayer(layer, true, true) }, '画像を追加');
    this.engine.committed();
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
    if (this.engine.isBusy()) return;
    this.finishFloating();
    const location = this.locationOf(id);
    if (!location) return;
    const ids = this.descendantIds(id);
    const removeIds = new Set(ids);
    const rasterCount = this.layers.filter((l) => l.type === 'raster').length;
    const removedRasterCount = this.layers.filter((l) => removeIds.has(l.id) && l.type === 'raster').length;
    if (rasterCount - removedRasterCount < 1) return;
    const snapshots = ids.map((layerId) => this.snapshotLayer(this.byId(layerId)!, true));
    const maskOps = this.detachMaskReferences(removeIds).map(change => ({
      kind: 'layerProps' as const,
      layerId: change.layerId,
      before: { state: { maskLayerIds: change.before } },
      after: { state: { maskLayerIds: change.after } },
    }));
    this.removeLayerInternal(id);
    const removeOp = { kind: 'layerRemove' as const, location, snapshots };
    this.engine.history.push(maskOps.length ? { kind: 'batch', ops: [removeOp, ...maskOps] } : removeOp, 'レイヤー削除');
    this.fixActive();
    this.engine.committed();
  }

  moveLayer(id: string, to: LayerLocation): boolean {
    if (this.engine.isBusy()) return false;
    const from = this.locationOf(id);
    if (!from || !canReparent(this.layers, id, to.parentId)) return false;
    const adjusted = { ...to };
    if (from.parentId === to.parentId && from.index < to.index) adjusted.index--;
    if (from.parentId === adjusted.parentId && from.index === adjusted.index) return false;
    this.detachLayer(id);
    this.insertAt(id, adjusted);
    this.engine.history.push({ kind: 'layerMove', layerId: id, from, to: adjusted }, 'レイヤー並べ替え');
    this.engine.committed();
    return true;
  }

  bakeAndMerge(upper: Layer, lower: RasterLayer, label: string, beforeActiveId: string): void {
    const beforeCanvas = makeCanvas(this.engine.artboard.w, this.engine.artboard.h);
    const beforeCtx = beforeCanvas.getContext('2d', { willReadFrequently: true })!;
    beforeCtx.drawImage(lower.runtime.canvas, 0, 0);
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
    const extraction = extractTiles(
      beforeCtx,
      lower.runtime.ctx,
      { minX: 0, minY: 0, maxX: this.engine.artboard.w, maxY: this.engine.artboard.h },
      this.engine.artboard.w,
      this.engine.artboard.h,
    );
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

  transferShapeLayer(): void {
    if (this.engine.isBusy()) return;
    if (!this.canTransferShape()) return;
    const layer = this.byId(this.activeLayerId)!;
    const parent = this.rasterById(layer.parentId!)!;
    this.bakeAndMerge(layer, parent, layer.type === 'image' ? '画像を転写' : '図形を転写', layer.id);
  }

  async applyLayerContent(snapshot: LayerSnapshot): Promise<void> {
    const current = this.byId(snapshot.id);
    if (!current || current.type !== snapshot.type) return;
    const restored = await restoreLayerFrom(snapshot, { artboard: this.engine.artboard });
    if (!restored || restored.type !== current.type) return;
    if (current.type === 'image' && restored.type === 'image') {
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
    const before = this.snapshotLayer(layer, true, true);
    layer.runtime = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true })! };
    this.bumpLayer(layer.id);
    const after = this.snapshotLayer(layer, true, true);
    this.engine.history.push({ kind: 'layerContent', layerId: layer.id, before, after }, '画像を差し替え');
    this.engine.committed();
  }

  fitImageAspect(id: string): void {
    if (this.engine.isBusy()) return;
    const layer = this.imageById(id);
    if (!layer) return;
    const afterImage = fitImageParamsToSource(layer.state.placement, layer.runtime.canvas.width, layer.runtime.canvas.height);
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
    this.engine.links.propagateFrom({ pageId: this.engine.pages.activePageId, layerId: id }, true);
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
      target: { pageId: this.engine.pages.activePageId, layerId: layer.id },
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
    this.engine.links.propagateFrom({ pageId: this.engine.pages.activePageId, layerId: id });
    this.engine.committed();
  }

  updateShapeParams(id: string, before: ShapeParams, after: ShapeParams, preview = false): void {
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
    const downstreamLinkOps = this.engine.links.propagateFrom({ pageId: this.engine.pages.activePageId, layerId: layer.id });
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
    if (!this.byId(id)) return;
    const st = useStore.getState();
    const previous = st.selectedLayerIds.length ? st.selectedLayerIds : [this.activeLayerId];
    const selected = [...previous.filter(existing => !!this.byId(existing)), ...(!previous.includes(id) ? [id] : [])];
    this.activeLayerId = selected[0] ?? id;
    this.applyMultiSelection(selected);
  }

  toggleDescendantSelection(id: string): void {
    const layer = this.byId(id);
    if (!layer?.childIds.length) return;
    const descendants = this.descendantIds(id).slice(1);
    const st = useStore.getState();
    const current = (st.selectedLayerIds.length ? st.selectedLayerIds : [this.activeLayerId])
      .filter(existing => !!this.byId(existing));
    const selected = new Set(current);
    const allDescendantsSelected = descendants.every(descendant => selected.has(descendant));
    if (st.multiSelectMode && selected.has(id) && allDescendantsSelected) {
      selected.delete(id);
      for (const descendant of descendants) selected.delete(descendant);
      const next = [...selected];
      if (!next.length) {
        this.activeLayerId = id;
        this.exitMultiSelect();
        return;
      }
      if (!next.includes(this.activeLayerId)) this.activeLayerId = next[0]!;
      this.applyMultiSelection(next);
      return;
    }
    if (!st.multiSelectMode) {
      this.activeLayerId = id;
      this.applyMultiSelection([id, ...descendants]);
      return;
    }
    selected.add(id);
    for (const descendant of descendants) selected.add(descendant);
    this.applyMultiSelection([...selected]);
  }

  exitMultiSelect(): void {
    const st = useStore.getState();
    st.set({ multiSelectMode: false, selectedLayerIds: this.activeLayerId ? [this.activeLayerId] : [] });
    this.engine.syncStore();
    this.engine.notifyLayerSelectionChange();
  }

  private applyMultiSelection(selected: string[]): void {
    const ids = [...new Set(selected.filter(id => !!this.byId(id)))];
    if (!ids.length) return;
    const st = useStore.getState();
    if (!ids.includes(this.activeLayerId)) this.activeLayerId = ids[0]!;
    if (!getToolDescriptor(st.tool ?? '')?.capabilities.multiSelect) st.deactivateTool();
    st.set({ multiSelectMode: true, selectedLayerIds: ids, shortcutTarget: { type: 'layer', id: this.activeLayerId } });
    this.engine.syncStore();
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
      this.engine.links.propagateFrom({ pageId: this.engine.pages.activePageId, layerId: id });
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
        this.engine.links.propagateFrom({ pageId: this.engine.pages.activePageId, layerId: id }, true);
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
      this.engine.links.propagateFrom({ pageId: this.engine.pages.activePageId, layerId });
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
    for (const { layerId } of changes) this.engine.links.propagateFrom({ pageId: this.engine.pages.activePageId, layerId });
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
