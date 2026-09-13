import { rectValid, type DirtyRect } from '../brush';
import { HISTORY_PRUNE_DEFAULT } from '../history/constants';
import {
  HistoryTree,
  type Op,
} from '../history/historyTree';
import { applyTiles, extractTiles } from '../history/tilePatch';
import { objectTransformProps } from '../layer-types/registry';
import type { RasterLayer } from '../layers';
import type { SparseRasterSurface } from '../raster/SparseRasterSurface';
import type { PaintEngine, SelectedObjectTransform } from '../PaintEngine';
import { useStore } from '../../state/store';

/** Owns HistoryTree and undo/redo / raster commit helpers. */
export class HistoryService {
  history = new HistoryTree();
  private readonly rasterPpiBefore = new Map<string, SparseRasterSurface>();

  constructor(private engine: PaintEngine) {}

  /**
   * Bin rasters keep their own PPI until the first pixel edit. The conversion is
   * synchronous so the following gesture sees one coherent pixel grid, while the
   * original surface is retained for the same history operation and cancellation.
   */
  prepareRasterEdit(layer: RasterLayer): SparseRasterSurface | undefined {
    const sparse = layer.runtime.sparse;
    const targetPpi = this.engine.getPageSpec().ppi;
    const ppiMismatch = !!sparse && Math.abs(sparse.ppi - targetPpi) >= 1e-6;
    if ((!this.engine.bins.activeBinId && !(layer.dataLink && ppiMismatch)) || !sparse) {
      return this.rasterPpiBefore.get(layer.id)?.clone();
    }
    const pending = this.rasterPpiBefore.get(layer.id);
    if (pending) return pending.clone();
    const before = sparse.clone();
    this.rasterPpiBefore.set(layer.id, before);
    if (ppiMismatch) {
      layer.runtime.sparse = sparse.resample(targetPpi);
      this.redrawRasterPage(layer);
      this.engine.layerService.bumpLayer(layer.id);
    }
    return before.clone();
  }

  cancelPreparedRasterEdit(layer: RasterLayer): void {
    const before = this.rasterPpiBefore.get(layer.id);
    if (!before) return;
    layer.runtime.sparse = before;
    this.rasterPpiBefore.delete(layer.id);
    this.redrawRasterPage(layer);
    this.engine.layerService.bumpLayer(layer.id);
  }

  /** Restore the pre-gesture pixels but retain the pending PPI conversion. */
  restartPreparedRasterEdit(layer: RasterLayer): void {
    const before = this.rasterPpiBefore.get(layer.id);
    if (!before) return;
    const targetPpi = this.engine.getPageSpec().ppi;
    layer.runtime.sparse = Math.abs(before.ppi - targetPpi) < 1e-6
      ? before.clone()
      : before.resample(targetPpi);
    this.redrawRasterPage(layer);
    this.engine.layerService.bumpLayer(layer.id);
  }

  private takePreparedRaster(layerId: string): SparseRasterSurface | undefined {
    const before = this.rasterPpiBefore.get(layerId);
    this.rasterPpiBefore.delete(layerId);
    return before;
  }

  private redrawRasterPage(layer: RasterLayer): void {
    const { w, h } = this.engine.pageFrame;
    layer.runtime.ctx.clearRect(0, 0, layer.runtime.canvas.width, layer.runtime.canvas.height);
    layer.runtime.sparse?.drawDocumentTo(layer.runtime.ctx, { x: 0, y: 0, w, h }, this.engine.getPageSpec().ppi);
  }

  async undo(): Promise<void> {
    const eng = this.engine;
    if (eng.isBusy()) return;
    if (eng.finishTextEditing()) return;
    if (eng.hasOpenSession()) {
      eng.cancelSessions();
      eng.scheduleSave();
      return;
    }
    const node = this.history.undo();
    if (!node) return;
    eng.setBusy(true);
    try {
      if (node.op) {
        await node.ready;
        await this.applyOp(node.op, 'undo');
      }
    } finally {
      eng.setBusy(false);
    }
    this.afterHistoryNav();
  }

  async redo(childIndex?: number): Promise<void> {
    const eng = this.engine;
    if (eng.isBusy()) return;
    if (eng.finishTextEditing()) return;
    if (eng.hasOpenSession()) {
      eng.cancelSessions();
      eng.scheduleSave();
    }
    const node = this.history.redo(childIndex);
    if (!node) return;
    eng.setBusy(true);
    try {
      if (node.op) {
        await node.ready;
        await this.applyOp(node.op, 'redo');
      }
    } finally {
      eng.setBusy(false);
    }
    this.afterHistoryNav();
  }

  afterHistoryNav(): void {
    const eng = this.engine;
    eng.links.reconcileAll();
    eng.layerService.fixActive();
    eng.syncTextRendersPublic();
    eng.requestRender();
    eng.syncStore();
    eng.scheduleSave();
  }

  async applyOp(op: Op, dir: 'undo' | 'redo'): Promise<void> {
    const eng = this.engine;
    const ls = eng.layerService;
    if (op.kind === 'batch') {
      const operations = dir === 'undo' ? [...op.ops].reverse() : op.ops;
      for (const item of operations) await this.applyOp(item, dir);
      return;
    }
    switch (op.kind) {
      case 'pageChange': {
        await eng.restorePageSnapshotPublic(dir === 'undo' ? op.before : op.after);
        break;
      }
      case 'raster': {
        const layer = ls.rasterById(op.layerId);
        if (layer) {
          await applyTiles(layer, op.tiles, dir === 'undo' ? 'before' : 'after');
          ls.bumpLayer(layer.id);
        }
        break;
      }
      case 'layerAdd': {
        if (dir === 'redo') { await ls.restoreLayer(op.snapshot, op.location); ls.activeLayerId = op.snapshot.id; }
        else ls.removeLayerInternal(op.snapshot.id);
        break;
      }
      case 'layerRemove': {
        if (dir === 'undo') {
          const entries = op.snapshots.map((snapshot) => ({
            location: snapshot.id === op.snapshots[0].id ? op.location : { scopeId: snapshot.placement?.scopeId ?? null, index: 0 },
            snapshot,
          }));
          await ls.restoreEntries(entries);
        } else ls.removeLayerInternal(op.snapshots[0].id);
        break;
      }
      case 'layerMove': {
        const to = dir === 'redo' ? op.to : op.from;
        ls.detachLayer(op.layerId);
        ls.insertAt(op.layerId, to);
        break;
      }
      case 'hierarchyChange': {
        ls.applyHierarchy(op.scopeId, dir === 'undo' ? op.before : op.after);
        break;
      }
      case 'layerProps': {
        const l = ls.byId(op.layerId);
        if (l) ls.assignProps(l, dir === 'undo' ? op.before : op.after);
        break;
      }
      case 'layerParameter': {
        eng.parameters.applyHistory(op, dir === 'undo' ? op.before : op.after);
        break;
      }
      case 'layerLink': {
        eng.links.applyHistoryLink(op.target, dir === 'undo' ? op.before : op.after);
        break;
      }
      case 'layerDataLink': {
        const layer = ls.byId(op.layerId);
        if (layer) {
          const value = dir === 'undo' ? op.before : op.after;
          layer.dataLink = value ? structuredClone(value) : undefined;
          layer.dataLinkInstanceId = dir === 'undo' ? op.beforeInstanceId : op.afterInstanceId;
          const structure = dir === 'undo' ? op.beforeStructureSource : op.afterStructureSource;
          layer.canvasStructureSource = structure ? structuredClone(structure) : undefined;
          ls.bumpLayer(layer.id);
        }
        break;
      }
      case 'layerReplace': {
        const remove = dir === 'undo' ? op.after : op.before;
        const restore = dir === 'undo' ? op.before : op.after;
        for (const id of remove.rootIds) if (ls.byId(id)) ls.removeLayerInternal(id);
        await ls.restoreEntries(restore.entries);
        const selection = restore.selection;
        ls.activeLayerId = selection.activeLayerId;
        useStore.getState().set({
          selectedLayerIds: [...selection.selectedLayerIds],
          multiSelectMode: selection.multiSelectMode,
        });
        for (const change of op.maskChanges ?? []) {
          const layer = ls.byId(change.layerId);
          if (layer) ls.assignProps(layer, { state: { maskLayerIds: [...(dir === 'undo' ? change.before : change.after)] } });
        }
        break;
      }
      case 'layerMerge': {
        const applyMaskChanges = () => {
          for (const change of op.maskChanges ?? []) {
            const layer = ls.byId(change.layerId);
            if (layer) ls.assignProps(layer, { state: { maskLayerIds: [...(dir === 'undo' ? change.before : change.after)] } });
          }
        };
        const target = ls.rasterById(op.targetLayerId);
        if (dir === 'undo') {
          if (target) {
            await applyTiles(target, op.tiles, 'before');
            if (op.targetProps) ls.assignProps(target, op.targetProps.before);
            ls.bumpLayer(target.id);
          }
          if (!ls.byId(op.removed.snapshot.id)) await ls.restoreEntries([op.removed]);
        } else {
          ls.removeLayerExact(op.removed.snapshot.id);
          if (target) {
            await applyTiles(target, op.tiles, 'after');
            if (op.targetProps) ls.assignProps(target, op.targetProps.after);
            ls.bumpLayer(target.id);
          }
        }
        ls.activeLayerId = dir === 'undo' ? op.beforeActiveId : op.afterActiveId;
        applyMaskChanges();
        break;
      }
      case 'layerContent': {
        await ls.applyLayerContent(dir === 'undo' ? op.before : op.after);
        break;
      }
    }
  }

  commitRasterBatch(
    entries: { layer: RasterLayer; before: HTMLCanvasElement; beforeSparse?: SparseRasterSurface; rect: DirtyRect }[],
    label: string,
    objects: SelectedObjectTransform[] = [],
  ): void {
    const eng = this.engine;
    const operations: Extract<Op, { kind: 'batch' }>['ops'] = eng.layerService.consumePendingTransformTargetOps();
    const ready: Promise<void>[] = [];
    for (const entry of entries) {
      if (!rectValid(entry.rect)) continue;
      if (entry.beforeSparse && entry.layer.runtime.sparse) {
        this.takePreparedRaster(entry.layer.id);
        eng.layerService.bumpLayer(entry.layer.id, entry.rect);
        const before = eng.layerService.snapshotLayer(entry.layer, false);
        const after = eng.layerService.snapshotLayer(entry.layer, false);
        const contentOp: Extract<Op, { kind: 'layerContent' }> = {
          kind: 'layerContent', layerId: entry.layer.id, before, after,
        };
        operations.push(contentOp);
        const afterSparse = entry.layer.runtime.sparse.clone();
        ready.push(Promise.all([entry.beforeSparse.toBlob(), afterSparse.toBlob()]).then(([beforeBlob, afterBlob]) => {
          contentOp.before.content = beforeBlob;
          contentOp.after.content = afterBlob;
        }));
        const dataLinkOp = eng.layerService.detachDataLink(entry.layer);
        if (dataLinkOp) operations.push(dataLinkOp);
        continue;
      }
      const before = entry.before.getContext('2d', { willReadFrequently: true })!;
      const extraction = extractTiles(before, entry.layer.runtime.ctx, entry.rect, eng.pageFrame.w, eng.pageFrame.h);
      if (extraction.tileCount === 0) continue;
      const dataLinkOp = eng.layerService.detachDataLink(entry.layer);
      if (dataLinkOp) operations.push(dataLinkOp);
      const rasterOp: Extract<Op, { kind: 'raster' }> = { kind: 'raster', layerId: entry.layer.id, tiles: [] };
      operations.push(rasterOp);
      ready.push(extraction.ready.then((tiles) => { rasterOp.tiles = tiles; }));
      eng.layerService.bumpLayer(entry.layer.id, entry.rect);
    }
    for (const entry of objects) {
      const layer = eng.layerService.byId(entry.id);
      if (!layer) continue;
      const after = objectTransformProps(layer);
      const propsOp = { kind: 'layerProps' as const, layerId: entry.id, before: entry.before, after };
      operations.push(propsOp);
      const dataLinkOp = eng.layerService.detachDataLink(layer);
      if (dataLinkOp) operations.push(dataLinkOp);
      const linkOp = eng.layerService.linkOpForUserChange(layer, entry.before, after);
      if (linkOp) operations.push(linkOp);
      eng.links.propagateFrom(eng.layerAddress(entry.id));
    }
    if (!operations.length) return;
    const node = this.history.push(operations.length === 1 ? operations[0] : { kind: 'batch', ops: operations }, label);
    node.ready = Promise.all(ready).then(() => undefined);
    void node.ready.then(() => eng.scheduleStorageRefresh());
    eng.committed(false);
  }

  commitRasterEdit(layer: RasterLayer, rect: DirtyRect, label: string): void {
    const eng = this.engine;
    if (!rectValid(rect)) {
      this.cancelPreparedRasterEdit(layer);
      return;
    }
    const ppiBefore = this.takePreparedRaster(layer.id);
    if (ppiBefore && layer.runtime.sparse) {
      eng.layerService.bumpLayer(layer.id, rect);
      const before = eng.layerService.snapshotLayer(layer, false);
      const after = eng.layerService.snapshotLayer(layer, false);
      const op: Extract<Op, { kind: 'layerContent' }> = { kind: 'layerContent', layerId: layer.id, before, after };
      const afterSparse = layer.runtime.sparse.clone();
      const dataLinkOp = eng.layerService.detachDataLink(layer);
      const node = this.history.push(dataLinkOp ? { kind: 'batch', ops: [op, dataLinkOp] } : op, label);
      node.ready = Promise.all([ppiBefore.toBlob(), afterSparse.toBlob()]).then(([beforeBlob, afterBlob]) => {
        op.before.content = beforeBlob;
        op.after.content = afterBlob;
      });
      void node.ready.then(() => eng.scheduleStorageRefresh());
      eng.committed(false);
      return;
    }
    const extraction = extractTiles(eng.compositor.scratchCtx, layer.runtime.ctx, rect, eng.pageFrame.w, eng.pageFrame.h);
    if (extraction.tileCount === 0) return;
    const op: Extract<Op, { kind: 'raster' }> = { kind: 'raster', layerId: layer.id, tiles: [] };
    const dataLinkOp = eng.layerService.detachDataLink(layer);
    const node = this.history.push(dataLinkOp ? { kind: 'batch', ops: [op, dataLinkOp] } : op, label);
    node.ready = extraction.ready.then((tiles) => { op.tiles = tiles; });
    void node.ready.then(() => eng.scheduleStorageRefresh());
    eng.layerService.bumpLayer(layer.id, rect);
    eng.committed(false);
  }

  pruneHistory(limit = HISTORY_PRUNE_DEFAULT): number {
    const eng = this.engine;
    if (eng.isBusy()) return 0;
    const removed = this.history.pruneToRecent(limit);
    if (removed > 0) {
      eng.syncStore();
      eng.scheduleSave();
      eng.scheduleStorageRefresh();
    }
    return removed;
  }
}
