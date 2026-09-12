import { useStore } from '../../state/store';
import {
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
  buildLayerSnapshot,
  layerHandler,
  layerTypeHandler,
  layerTypeProps,
  restoreLayerFrom,
} from '../layer-types/registry';
import { shapeLayerName } from '../layer-types/shape';
import { textFrame } from '../layer-types/text';
import {
  createAdjustLayer,
  createClipLayer,
  createOutlineLayer,
  createRasterLayer,
  createShapeLayer,
  createTextLayer,
  makeCanvas,
  type Layer,
  type RasterLayer,
  type ShapeLayer,
} from '../layers';
import { canReparent, closestRasterOrRoot, structuralLowerId } from '../layerTree';
import { isEmptyText } from '../text/model';
import type { PaintEngine } from '../PaintEngine';
import { cloneShape, polygonFromWorldPoints, shapeCorners } from '../shapes';
import { layerParameterDescriptors, parameterSemanticId, type LayerParameterValue } from '../layerParameters';
import type { DirtyRect } from '../brush';

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
    return layerTypeHandler(type).defaultName(index);
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
    const affectsMask = p.opacity !== undefined || p.shape !== undefined || p.text !== undefined || p.outline !== undefined;
    if (p.name !== undefined) l.name = p.name;
    if (p.opacity !== undefined) l.opacity = p.opacity;
    if (p.blend !== undefined) l.blend = p.blend;
    if (p.visible !== undefined) l.visible = p.visible;
    if (p.parameterLink !== undefined) l.parameterLink = p.parameterLink ? structuredClone(p.parameterLink) : undefined;
    layerHandler(l).applyProps(l, p);
    this.versions.set(l.id, (this.versions.get(l.id) ?? 0) + 1);
    if (affectsMask) this.bumpMaskVersion(l.id);
  }

  /** 削除されるレイヤーを参照しているマスク設定を外す */
  maskReferenceOps(removedIds: Set<string>): { layerId: string; before: string[]; after: string[] }[] {
    return this.layers.flatMap(layer => {
      const before = layerTypeProps(layer).maskLayerIds;
      if (!before || removedIds.has(layer.id) || !before.some(id => removedIds.has(id))) return [];
      return [{ layerId: layer.id, before, after: before.filter(id => !removedIds.has(id)) }];
    });
  }

  detachMaskReferences(removedIds: Set<string>): { layerId: string; before: string[]; after: string[] }[] {
    const changes = this.maskReferenceOps(removedIds);
    for (const change of changes) {
      const layer = this.byId(change.layerId);
      if (layer) this.assignProps(layer, { maskLayerIds: change.after });
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
    if (!layerHandler(layer).effect) return this.mergeTarget(layer);
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
    const layer = this.shapeById(id);
    return !!layer && layer.childIds.length === 0 && !!layer.parentId && !!this.rasterById(layer.parentId);
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
    return l ? layerHandler(l).contentCanvas(l, this.engine.compositor.measureEnv()) : null;
  }

  getShape(id: string): ShapeParams | null {
    const layer = this.shapeById(id);
    return layer ? cloneShape(layer.shape) : null;
  }

  getText(id: string): TextParams | null {
    const layer = this.byId(id);
    return layer?.type === 'text' ? structuredClone(layer.text) : null;
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
    const ids = new Set(useStore.getState().selectedLayerIds);
    return this.layers.some(layer => ids.has(layer.id) && !!layerHandler(layer).objectTransform);
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
    const layer = this.byId(id);
    if (layer?.type !== 'text' || layer.childIds.length > 0 || !isEmptyText(layer.text)) return false;
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
      { ...layer, text: structuredClone(before) },
      { ...layer, text: structuredClone(after) },
    ) : null;
    layer.text = structuredClone(after);
    if (linkChange) layer.parameterLink = structuredClone(linkChange.after);
    this.bumpLayer(id);
    const contentBefore = { ...before, x: 0, y: 0, width: null, height: null };
    const contentAfter = { ...after, x: 0, y: 0, width: null, height: null };
    const frameOnlyPreview = preview && JSON.stringify(contentBefore) === JSON.stringify(contentAfter);
    if (!frameOnlyPreview) this.engine.syncTextRendersPublic();
    if (!preview && JSON.stringify(before) !== JSON.stringify(after)) {
      const propsOp = { kind: 'layerProps' as const, layerId: id, before: { text: structuredClone(before) }, after: { text: structuredClone(after) } };
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
        const cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2, angle = -(layer.text.rotation ?? 0);
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
      before: { maskLayerIds: change.before },
      after: { maskLayerIds: change.after },
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
    beforeCtx.drawImage(lower.canvas, 0, 0);
    const removedLocation = this.locationOf(upper.id);
    if (!removedLocation) return;
    const removedSnapshot = this.snapshotLayer(upper, true);
    const maskChanges = this.detachMaskReferences(new Set(this.descendantIds(upper.id)));
    const effectMerge = !!layerHandler(upper).effect;
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
      lower.ctx,
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
    const shape = this.shapeById(this.activeLayerId)!;
    const parent = this.rasterById(shape.parentId!)!;
    this.bakeAndMerge(shape, parent, '図形を転写', shape.id);
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
      return;
    }
    if (id === this.activeLayerId) return;
    this.finishFloating();
    this.activeLayerId = id;
    this.engine.requestOverlayRender();
    this.engine.syncStore();
    this.engine.shapeEdit.refreshVertexState();
    this.engine.scheduleSave();
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
      { ...layer, ...structuredClone(before), parameterLink: layer.parameterLink } as import('../layer-types/types').LayerParameterLayer,
      { ...layer, ...structuredClone(after), parameterLink: layer.parameterLink } as import('../layer-types/types').LayerParameterLayer,
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
    if (preview) this.previewLayerProps(id, { shape: after });
    else this.commitLayerProps(id, { shape: before }, { shape: after }, '図形を編集');
  }

  convertRectToPolygon(id = this.activeLayerId): void {
    if (this.engine.isBusy()) return;
    const layer = this.shapeById(id);
    if (!layer || layer.shape.kind !== 'rect') return;
    const beforeShape = cloneShape(layer.shape);
    const beforeName = layer.name;
    const center = { x: layer.shape.x + layer.shape.width / 2, y: layer.shape.y + layer.shape.height / 2 };
    const world = shapeCorners(layer.shape);
    const polygon = polygonFromWorldPoints(world, layer.shape);
    polygon.cx = center.x; polygon.cy = center.y;
    polygon.rotation = 0;
    polygon.points = world.map(point => ({ x: point.x - center.x, y: point.y - center.y }));
    this.assignProps(layer, { shape: polygon });
    if (layer.name === '四角形') layer.name = '多角形';
    const propsOp = {
      kind: 'layerProps', layerId: layer.id,
      before: { shape: beforeShape, name: beforeName },
      after: { shape: cloneShape(layer.shape), name: layer.name },
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
  }

  private applyMultiSelection(selected: string[]): void {
    const ids = [...new Set(selected.filter(id => !!this.byId(id)))];
    if (!ids.length) return;
    const st = useStore.getState();
    if (!ids.includes(this.activeLayerId)) this.activeLayerId = ids[0]!;
    if (!getToolDescriptor(st.tool ?? '')?.capabilities.multiSelect) st.deactivateTool();
    st.set({ multiSelectMode: true, selectedLayerIds: ids, shortcutTarget: { type: 'layer', id: this.activeLayerId } });
    this.engine.syncStore();
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
      const before = cloneShape(layer.shape);
      const after = update(cloneShape(before));
      if (JSON.stringify(before) === JSON.stringify(after)) return [];
      layer.shape = after;
      this.bumpLayer(layerId);
      const propsOp = { kind: 'layerProps' as const, layerId, before: { shape: before }, after: { shape: after } };
      const linkOp = this.linkOpForUserChange(layer, propsOp.before, propsOp.after);
      this.engine.links.propagateFrom({ pageId: this.engine.pages.activePageId, layerId });
      return linkOp ? [propsOp, linkOp] : [propsOp];
    });
    if (!ops.length) return;
    this.engine.history.push({ kind: 'batch', ops }, '図形の共通設定');
    this.engine.committed();
  }

  updateSelectedParameter(key: string, value: LayerParameterValue): void {
    if (this.engine.isBusy()) return;
    this.engine.events.emit('textCommitRequest');
    const state = useStore.getState();
    const ids = state.multiSelectMode ? state.selectedLayerIds : [this.activeLayerId];
    const changes = ids.flatMap(layerId => {
      const layer = this.byId(layerId);
      if (!layer) return [];
      const descriptor = layerParameterDescriptors(layer).find(item => item.key === key || parameterSemanticId(item) === key);
      if (!descriptor) return [];
      const before: LayerProps = {
        opacity: layer.opacity, visible: layer.visible, blend: layer.blend,
        ...layerTypeProps(layer),
      };
      const after = descriptor.write(layer, value);
      return [{ layer, layerId, before, after }];
    });
    for (const change of changes) {
      this.assignProps(change.layer, change.after);
      this.bumpLayer(change.layer.id);
    }
    const ops: import('../history/historyTree').AtomicOp[] = changes.flatMap(({ layer, layerId, before, after }) => {
      const propsOp = { kind: 'layerProps' as const, layerId, before, after };
      const linkOp = this.linkOpForUserChange(layer, before, after, true);
      return linkOp ? [propsOp, linkOp] : [propsOp];
    });
    if (!ops.length) return;
    this.engine.history.push(ops.length === 1 ? ops[0] : { kind: 'batch', ops }, key === 'snapEnabled' ? 'スナップを変更' : '共通パラメータを変更');
    for (const { layerId } of changes) this.engine.links.propagateFrom({ pageId: this.engine.pages.activePageId, layerId });
    this.engine.committed();
  }

  previewSelectedParameter(key: string, value: LayerParameterValue): void {
    const state = useStore.getState();
    const ids = state.multiSelectMode ? state.selectedLayerIds : [this.activeLayerId];
    for (const layerId of ids) {
      const layer = this.byId(layerId);
      if (!layer) continue;
      const descriptor = layerParameterDescriptors(layer).find(item => item.key === key || parameterSemanticId(item) === key);
      if (!descriptor) continue;
      this.assignProps(layer, descriptor.write(layer, value));
      this.engine.links.propagateFrom({ pageId: this.engine.pages.activePageId, layerId }, true);
    }
    this.engine.requestRender();
    this.engine.syncStore();
  }

  commitSelectedParameterPreview(key: string, beforeValue: LayerParameterValue, value: LayerParameterValue): void {
    const state = useStore.getState();
    const ids = state.multiSelectMode ? state.selectedLayerIds : [this.activeLayerId];
    const changes = ids.flatMap(layerId => {
      const layer = this.byId(layerId);
      if (!layer) return [];
      const descriptor = layerParameterDescriptors(layer).find(item => item.key === key || parameterSemanticId(item) === key);
      if (!descriptor) return [];
      return [{ layer, layerId, before: descriptor.write(layer, beforeValue), after: descriptor.write(layer, value) }];
    });
    const ops: import('../history/historyTree').AtomicOp[] = changes.flatMap(({ layer, layerId, before, after }) => {
      this.assignProps(layer, after);
      const propsOp = { kind: 'layerProps' as const, layerId, before, after };
      const linkOp = this.linkOpForUserChange(layer, before, after, true);
      return linkOp ? [propsOp, linkOp] : [propsOp];
    });
    if (!ops.length) return;
    this.engine.history.push(ops.length === 1 ? ops[0] : { kind: 'batch', ops }, '共通パラメータを変更');
    for (const { layerId } of changes) this.engine.links.propagateFrom({ pageId: this.engine.pages.activePageId, layerId });
    this.engine.committed();
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
