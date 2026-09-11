import { rectValid, type DirtyRect } from '../brush';
import { HISTORY_PRUNE_DEFAULT } from '../history/constants';
import {
  HistoryTree,
  type LayerProps,
  type Op,
} from '../history/historyTree';
import { applyTiles, extractTiles } from '../history/tilePatch';
import type { RasterLayer } from '../layers';
import type { PaintEngine, SelectedObjectTransform } from '../PaintEngine';

/** Owns HistoryTree and undo/redo / raster commit helpers. */
export class HistoryService {
  history = new HistoryTree();

  constructor(private engine: PaintEngine) {}

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
      case 'canvasChange': {
        await eng.restoreCanvasSnapshotPublic(dir === 'undo' ? op.before : op.after);
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
            location: snapshot.id === op.snapshots[0].id ? op.location : { parentId: snapshot.parentId, index: 0 },
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
        if (l) ls.assignProps(l, dir === 'undo' ? op.before : op.after);
        break;
      }
      case 'layerMerge': {
        const applyMaskChanges = () => {
          for (const change of op.maskChanges ?? []) {
            const layer = ls.byId(change.layerId);
            if (layer?.type === 'adjust') layer.maskLayerIds = [...(dir === 'undo' ? change.before : change.after)];
          }
        };
        const target = ls.rasterById(op.targetLayerId);
        if (dir === 'undo') {
          if (target) {
            await applyTiles(target, op.tiles, 'before');
            ls.bumpLayer(target.id);
          }
          if (!ls.byId(op.removed.snapshot.id)) await ls.restoreEntries([op.removed]);
        } else {
          ls.removeLayerExact(op.removed.snapshot.id);
          if (target) {
            await applyTiles(target, op.tiles, 'after');
            ls.bumpLayer(target.id);
          }
        }
        ls.activeLayerId = dir === 'undo' ? op.beforeActiveId : op.afterActiveId;
        applyMaskChanges();
        break;
      }
    }
  }

  commitRasterBatch(
    entries: { layer: RasterLayer; before: HTMLCanvasElement; rect: DirtyRect }[],
    label: string,
    objects: SelectedObjectTransform[] = [],
  ): void {
    const eng = this.engine;
    const operations: Extract<Op, { kind: 'batch' }>['ops'] = [];
    const ready: Promise<void>[] = [];
    for (const entry of entries) {
      if (!rectValid(entry.rect)) continue;
      const before = entry.before.getContext('2d', { willReadFrequently: true })!;
      const extraction = extractTiles(before, entry.layer.ctx, entry.rect, eng.artboard.w, eng.artboard.h);
      if (extraction.tileCount === 0) continue;
      const rasterOp: Extract<Op, { kind: 'raster' }> = { kind: 'raster', layerId: entry.layer.id, tiles: [] };
      operations.push(rasterOp);
      ready.push(extraction.ready.then((tiles) => { rasterOp.tiles = tiles; }));
      eng.layerService.bumpLayer(entry.layer.id);
    }
    for (const entry of objects) {
      const layer = eng.layerService.byId(entry.id);
      if (!layer) continue;
      const after: LayerProps = layer.type === 'shape' ? { shape: { ...layer.shape } } : layer.type === 'text' ? { text: structuredClone(layer.text) } : {};
      operations.push({ kind: 'layerProps', layerId: entry.id, before: entry.before, after });
    }
    if (!operations.length) return;
    const node = this.history.push(operations.length === 1 ? operations[0] : { kind: 'batch', ops: operations }, label);
    node.ready = Promise.all(ready).then(() => undefined);
    void node.ready.then(() => eng.scheduleStorageRefresh());
    eng.committed();
  }

  commitRasterEdit(layer: RasterLayer, rect: DirtyRect, label: string): void {
    const eng = this.engine;
    if (!rectValid(rect)) return;
    const extraction = extractTiles(eng.compositor.scratchCtx, layer.ctx, rect, eng.artboard.w, eng.artboard.h);
    if (extraction.tileCount === 0) return;
    const op: Extract<Op, { kind: 'raster' }> = { kind: 'raster', layerId: layer.id, tiles: [] };
    const node = this.history.push(op, label);
    node.ready = extraction.ready.then((tiles) => { op.tiles = tiles; });
    void node.ready.then(() => eng.scheduleStorageRefresh());
    eng.layerService.bumpLayer(layer.id);
    eng.committed();
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
