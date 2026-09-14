import { recordLocation } from '../layer-types/scopes';
import { parameterById } from '../parameters/host';
import { toCanonical, fromCanonical } from '../parameters/codec';
import { rectValid, type DirtyRect } from '../brush';
import { HISTORY_PRUNE_DEFAULT } from '../history/constants';
import {
  HistoryTree,
  type Op,
} from '../history/historyTree';
import { applyTiles, extractSparseTiles } from '../history/tilePatch';
import type { RasterLayer } from '../layers';
import type { PaintEngine, SelectedObjectTransform } from '../PaintEngine';
import { useStore } from '../../state/store';

/** Owns HistoryTree and undo/redo / raster commit helpers. */
export class HistoryService {
  history = new HistoryTree();

  constructor(private engine: PaintEngine) {}

  normalize(op: Op): Op {
    if (op.kind === 'batch') return {...op, ops: op.ops.map(item => this.normalize(item) as typeof item)};
    const eng = this.engine;
    if (op.kind === 'layerProps' && op.unit !== 'mm') return {...op, unit: 'mm'};
    if (op.kind === 'layerParameter' && op.unit !== 'mm') {
      const layer = eng.layerById(op.layerId), parameter = layer && parameterById(layer, op.parameterId);
      if (parameter) return {...op, unit: 'mm', before: toCanonical(parameter, op.before, 25.4), after: toCanonical(parameter, op.after, 25.4)};
    }
    return op;
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
    await this.afterHistoryNav();
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
    await this.afterHistoryNav();
  }

  async afterHistoryNav(): Promise<void> {
    const eng = this.engine;
    eng.links.reconcileAll();
    await eng.canvases.reconcile();
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
      case 'layerStacks':
        eng.stacks.restore(dir === 'undo' ? op.before : op.after);
        break;
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
            location: snapshot.id === op.snapshots[0].id ? op.location : recordLocation(op.snapshots, snapshot.id),
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
      case 'layerProps': {
        const l = ls.byId(op.layerId);
        if (l) {
          const props = dir === 'undo' ? op.before : op.after;
          ls.assignProps(l, props);
        }
        break;
      }
      case 'layerParameter': {
        const layer = ls.byId(op.layerId), parameter = layer && parameterById(layer, op.parameterId);
        const value = dir === 'undo' ? op.before : op.after;
        eng.parameters.applyHistory(op, op.unit === 'mm' && parameter ? fromCanonical(parameter, value, 25.4) : value);
        break;
      }
      case 'layerLink': {
        eng.links.applyHistoryLink(op.target, dir === 'undo' ? op.before : op.after);
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
    entries: { layer: RasterLayer; before: import("../raster/SparseRaster").SparseRasterSnapshot; rect: DirtyRect }[],
    label: string,
    objects: SelectedObjectTransform[] = [],
  ): void {
    const eng = this.engine;
    const operations: Extract<Op, { kind: 'batch' }>['ops'] = [];
    const ready: Promise<void>[] = [];
    for (const entry of entries) {
      if (!rectValid(entry.rect)) continue;
      const extraction = extractSparseTiles(entry.before, entry.layer.runtime.surface.snapshot());
      if (extraction.tileCount === 0) {
        if (entry.layer.runtime.surface.contentDetached) {entry.layer.runtime.surface.restore(entry.before); eng.links.resolveLayer(entry.layer);}
        continue;
      }
      const contentOp = eng.links.detachRasterContent(entry.layer, entry.before);
      if (contentOp) {
        operations.push(contentOp);
        eng.layerService.bumpLayer(entry.layer.id, entry.rect);
        continue;
      }
      const rasterOp: Extract<Op, { kind: 'raster' }> = { kind: 'raster', layerId: entry.layer.id, tiles: [] };
      operations.push(rasterOp);
      ready.push(extraction.ready.then((tiles) => { rasterOp.tiles = tiles; }));
      eng.layerService.bumpLayer(entry.layer.id, entry.rect);
    }
    operations.push(...eng.objects.commitOps(objects));
    if (!operations.length) return;
    const node = this.history.push(operations.length === 1 ? operations[0] : { kind: 'batch', ops: operations }, label);
    node.ready = Promise.all(ready).then(() => undefined);
    void node.ready.then(() => eng.scheduleStorageRefresh());
    eng.committed(false);
  }

  commitRasterEdit(layer: RasterLayer, rect: DirtyRect, label: string): void {
    const eng = this.engine;
    if (!rectValid(rect)) return;
    const before = eng.compositor.rasterBefore;
    if (!before) return;
    const extraction = extractSparseTiles(before, layer.runtime.surface.snapshot());
    if (extraction.tileCount === 0) {
      if (layer.runtime.surface.contentDetached) {layer.runtime.surface.restore(before); eng.links.resolveLayer(layer);}
      return;
    }
    const contentOp = eng.links.detachRasterContent(layer, before);
    if (contentOp) {
      this.history.push(contentOp, label);
      eng.layerService.bumpLayer(layer.id, rect); eng.committed(false);
      return;
    }
    const op: Extract<Op, { kind: 'raster' }> = { kind: 'raster', layerId: layer.id, tiles: [] };
    const node = this.history.push(op, label);
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
