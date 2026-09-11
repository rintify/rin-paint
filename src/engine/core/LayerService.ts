import { useStore } from '../../state/store';
import {
  DEFAULT_ADJUST,
  type ShapeParams,
  type TextParams,
} from '../../model';
import {
  type LayerLocation,
  type LocatedLayerSnapshot,
  type LayerProps,
  type LayerSnapshot,
  type TileLayerMergeOp,
} from '../history/historyTree';
import { extractTiles } from '../history/tilePatch';
import {
  createAdjustLayer,
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

function toBlobP(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}

/** Owns layer tree state and layer CRUD / tree mutation helpers. */
export class LayerService {
  layers: Layer[] = [];
  rootLayerIds: string[] = [];
  activeLayerId = '';
  versions = new Map<string, number>();
  layerCounter = 0;
  adjustCounter = 0;

  constructor(private engine: PaintEngine) {}

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

  bumpLayer(id: string): void {
    this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
    this.engine.requestRender();
  }

  snapshotLayer(l: Layer, withContent: boolean, keepCanvas = false): LayerSnapshot {
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
      const copy = makeCanvas(this.engine.artboard.w, this.engine.artboard.h);
      copy.getContext('2d')!.drawImage(l.canvas, 0, 0);
      snap.canvas = copy;
      if (!keepCanvas) {
        void toBlobP(copy).then((b) => {
          snap.blob = b;
          snap.canvas = undefined;
          this.engine.scheduleStorageRefresh();
        });
      }
    }
    return snap;
  }

  async restoreLayer(snap: LayerSnapshot, location?: LayerLocation): Promise<void> {
    let layer: Layer;
    if (snap.type === 'raster') {
      const l = createRasterLayer(snap.name, this.engine.artboard.w, this.engine.artboard.h, snap.id);
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
    if (p.name !== undefined) l.name = p.name;
    if (p.opacity !== undefined) l.opacity = p.opacity;
    if (p.blend !== undefined) l.blend = p.blend;
    if (p.visible !== undefined) l.visible = p.visible;
    if (p.params !== undefined && l.type === 'adjust') l.params = { ...p.params };
    if (p.maskLayerIds !== undefined && l.type === 'adjust') l.maskLayerIds = [...p.maskLayerIds];
    if (p.shape !== undefined && l.type === 'shape') l.shape = { ...p.shape };
    if (p.text !== undefined && l.type === 'text') l.text = structuredClone(p.text);
  }

  detachMaskReferences(removedIds: Set<string>): { layerId: string; before: string[]; after: string[] }[] {
    return this.layers.flatMap(layer => {
      if (layer.type !== 'adjust' || removedIds.has(layer.id) || !layer.maskLayerIds.some(id => removedIds.has(id))) return [];
      const before = [...layer.maskLayerIds], after = before.filter(id => !removedIds.has(id));
      layer.maskLayerIds = after;
      return [{ layerId: layer.id, before, after }];
    });
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
    return !!layer && !!this.mergeTarget(layer);
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
    return l?.type === 'text' ? this.engine.compositor.textRenderer.get(id) : l?.type === 'raster' ? l.canvas : null;
  }

  getShape(id: string): ShapeParams | null {
    const layer = this.shapeById(id);
    return layer ? { ...layer.shape } : null;
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
    return this.layers.some(layer => ids.has(layer.id) && (layer.type === 'shape' || layer.type === 'text'));
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
    layer.text = structuredClone(after);
    this.bumpLayer(id);
    const contentBefore = { ...before, x: 0, y: 0, width: null, height: null };
    const contentAfter = { ...after, x: 0, y: 0, width: null, height: null };
    const frameOnlyPreview = preview && JSON.stringify(contentBefore) === JSON.stringify(contentAfter);
    if (!frameOnlyPreview) this.engine.syncTextRendersPublic();
    if (!preview && JSON.stringify(before) !== JSON.stringify(after)) {
      this.engine.history.push({ kind: 'layerProps', layerId: id, before: { text: structuredClone(before) }, after: { text: structuredClone(after) } }, '文字を編集');
      this.engine.committed();
    } else this.engine.syncStore();
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
        const canvas = this.engine.compositor.textRenderer.get(id);
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
    const layer = createRasterLayer(`レイヤー ${++this.layerCounter}`, this.engine.artboard.w, this.engine.artboard.h);
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
    const layer = createAdjustLayer(`色調補正 ${++this.adjustCounter}`);
    this.layers.push(layer);
    this.insertAt(layer.id, location);
    this.activeLayerId = layer.id;
    this.engine.history.push(
      { kind: 'layerAdd', location, snapshot: this.snapshotLayer(layer, false) },
      '補正レイヤー追加',
    );
    this.engine.committed();
  }

  addShapeLayer(shape: ShapeParams): void {
    if (this.engine.isBusy()) return;
    const parentId = closestRasterOrRoot(this.layers, this.activeLayerId);
    const siblings = this.siblingIds(parentId);
    const location: LayerLocation = { parentId, index: siblings.length };
    const names = { line: '直線', rect: '四角形', ellipse: '楕円' } as const;
    const layer = createShapeLayer(names[shape.kind], shape);
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
    const maskOps = this.layers.flatMap(layer => {
      if (layer.type !== 'adjust' || removeIds.has(layer.id) || !layer.maskLayerIds.some(maskId => removeIds.has(maskId))) return [];
      const after = layer.maskLayerIds.filter(maskId => !removeIds.has(maskId));
      const op = { kind: 'layerProps' as const, layerId: layer.id, before: { maskLayerIds: [...layer.maskLayerIds] }, after: { maskLayerIds: after } };
      layer.maskLayerIds = after;
      return [op];
    });
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
    this.engine.compositor.bakeLayerOnto(lower, upper);
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
    const lower = this.mergeTarget(upper);
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
    if (state.multiSelectMode) {
      const selected = new Set(state.selectedLayerIds);
      const removing = selected.has(id);
      if (removing) selected.delete(id); else selected.add(id);
      if (selected.size === 0) selected.add(id);
      this.activeLayerId = removing ? [...selected].at(-1)! : id;
      state.set({ selectedLayerIds: [...selected] });
      this.engine.syncStore();
      return;
    }
    if (id === this.activeLayerId) return;
    this.finishFloating();
    this.activeLayerId = id;
    this.engine.requestRender();
    this.engine.syncStore();
    this.engine.scheduleSave();
  }

  previewLayerProps(id: string, props: LayerProps): void {
    if (this.engine.isBusy()) return;
    const l = this.byId(id);
    if (!l) return;
    this.assignProps(l, props);
    this.engine.requestRender();
    this.engine.syncStore();
  }

  commitLayerProps(id: string, before: LayerProps, after: LayerProps, label: string): void {
    if (this.engine.isBusy()) return;
    this.engine.events.emit('textCommitRequest');
    const l = this.byId(id);
    if (!l) return;
    this.assignProps(l, after);
    this.engine.history.push({ kind: 'layerProps', layerId: id, before, after }, label);
    this.engine.committed();
  }

  updateShapeParams(id: string, before: ShapeParams, after: ShapeParams, preview = false): void {
    if (preview) this.previewLayerProps(id, { shape: after });
    else this.commitLayerProps(id, { shape: before }, { shape: after }, '図形を編集');
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
    const selected = new Set(st.selectedLayerIds.length ? st.selectedLayerIds : [this.activeLayerId]);
    selected.add(id);
    this.activeLayerId = id;
    if (st.tool !== 'lasso') st.deactivateTool();
    st.set({ multiSelectMode: true, selectedLayerIds: [...selected] });
    this.engine.syncStore();
  }

  exitMultiSelect(): void {
    const st = useStore.getState();
    st.set({ multiSelectMode: false, selectedLayerIds: this.activeLayerId ? [this.activeLayerId] : [] });
    this.engine.syncStore();
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
    this.engine.history.push(ops.length === 1 ? ops[0] : { kind: 'batch', ops }, label);
    this.engine.committed();
  }

  previewSelectedLayerProps(props: LayerProps): void {
    const state = useStore.getState();
    for (const id of state.selectedLayerIds) {
      const layer = this.byId(id);
      if (layer) this.assignProps(layer, props);
    }
    this.engine.requestRender();
    this.engine.syncStore();
  }

  updateSelectedShapes(update: (shape: ShapeParams) => ShapeParams): void {
    const ops = useStore.getState().selectedLayerIds.flatMap(layerId => {
      const layer = this.byId(layerId);
      if (layer?.type !== 'shape') return [];
      const before = { ...layer.shape };
      const after = update({ ...before });
      if (JSON.stringify(before) === JSON.stringify(after)) return [];
      layer.shape = after;
      this.bumpLayer(layerId);
      return [{ kind: 'layerProps' as const, layerId, before: { shape: before }, after: { shape: after } }];
    });
    if (!ops.length) return;
    this.engine.history.push({ kind: 'batch', ops }, '図形の共通設定');
    this.engine.committed();
  }

  commitSelectedLayerOpacity(beforeById: Record<string, number>, opacity: number): void {
    const ops = Object.entries(beforeById).flatMap(([layerId, before]) => {
      const layer = this.byId(layerId);
      if (!layer || before === opacity) return [];
      layer.opacity = opacity;
      return [{ kind: 'layerProps' as const, layerId, before: { opacity: before }, after: { opacity } }];
    });
    if (!ops.length) return;
    this.engine.history.push(ops.length === 1 ? ops[0] : { kind: 'batch', ops }, '複数レイヤーの不透明度');
    this.engine.committed();
  }

  resetCountersFromLayers(): void {
    this.layerCounter = this.layers.filter(layer => layer.type === 'raster').length;
    this.adjustCounter = this.layers.filter(layer => layer.type === 'adjust').length;
  }

  replaceTree(layers: Layer[], rootLayerIds: string[], activeLayerId: string): void {
    this.layers = layers;
    this.rootLayerIds = rootLayerIds;
    this.activeLayerId = activeLayerId;
  }

  clearVersions(): void {
    this.versions.clear();
  }
}
