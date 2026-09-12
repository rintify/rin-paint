import { useStore } from '../../state/store';
import type { ShapeParams, ShapePoint, StrokePoint } from '../../model';
import { normalizePolygonSplitToolSettings } from '../../tools/polygonSplit/settings';
import type { Pair, Polygon } from 'polygon-clipping';
import type {
  LayerReplaceOp,
  LayerReplaceSide,
  LayerSelectionSnapshot,
  LocatedLayerSnapshot,
} from '../history/historyTree';
import { newLayerId } from '../layers';
import {
  cloneShape,
  polygonArea,
  polygonFromWorldPoints,
  shapePaintMode,
  shapePoints,
} from '../shapes';
import type { PaintEngine } from '../PaintEngine';
import { mmToPx } from '../units';

type TargetShape = Extract<ShapeParams, { kind: 'rect' | 'polygon' }>;
interface SplitResult { id: string; fragments: ShapePoint[][] }

type PolygonClipper = Pick<typeof import('polygon-clipping'), 'intersection'>;

function selectionSnapshot(engine: PaintEngine): LayerSelectionSnapshot {
  const state = useStore.getState();
  return {
    activeLayerId: engine.layerService.activeLayerId,
    selectedLayerIds: [...state.selectedLayerIds],
    multiSelectMode: state.multiSelectMode,
  };
}

function cleanRing(ring: number[][]): ShapePoint[] {
  const raw = ring.map(([x, y]) => ({ x, y }));
  if (raw.length > 1 && Math.hypot(raw[0].x - raw.at(-1)!.x, raw[0].y - raw.at(-1)!.y) < 1e-7) raw.pop();
  return raw.filter((point, index) => {
    const previous = raw[(index - 1 + raw.length) % raw.length];
    return Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-7;
  });
}

export function clipPolygonByBand(
  clipping: PolygonClipper,
  points: ShapePoint[],
  a: ShapePoint,
  b: ShapePoint,
  width: number,
  extentHint = 0,
): ShapePoint[][] {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  if (length < .01 || points.length < 3) return [];
  const ux = dx / length, uy = dy / length, nx = -uy, ny = ux;
  const maxAbs = Math.max(extentHint, ...points.flatMap(point => [Math.abs(point.x), Math.abs(point.y)]));
  const extent = Math.max(10, (maxAbs + Math.hypot(extentHint, extentHint) + width + 10) * 4);
  const halfPlane = (sign: 1 | -1): Polygon => {
    const offset = width / 2;
    const bx = a.x + nx * offset * sign, by = a.y + ny * offset * sign;
    return [[
      [bx - ux * extent, by - uy * extent],
      [bx + ux * extent, by + uy * extent],
      [bx + ux * extent + nx * extent * sign, by + uy * extent + ny * extent * sign],
      [bx - ux * extent + nx * extent * sign, by - uy * extent + ny * extent * sign],
      [bx - ux * extent, by - uy * extent],
    ]];
  };
  const ring: Pair[] = [...points.map(point => [point.x, point.y] as Pair), [points[0].x, points[0].y]];
  const subject: Polygon = [ring];
  const fragments: ShapePoint[][] = [];
  for (const sign of [-1, 1] as const) {
    const output = clipping.intersection(subject, halfPlane(sign));
    for (const polygon of output) {
      const cleaned = cleanRing(polygon[0] ?? []);
      if (cleaned.length >= 3 && Math.abs(polygonArea(cleaned)) >= .01) fragments.push(cleaned);
    }
  }
  return fragments.sort((left, right) => Math.abs(polygonArea(right)) - Math.abs(polygonArea(left)));
}

export class PolygonSplitService {
  constructor(private engine: PaintEngine) {}

  async split(a: StrokePoint, b: StrokePoint): Promise<void> {
    const eng = this.engine, ls = eng.layerService;
    if (eng.isBusy()) return;
    const state = useStore.getState();
    const selectedIds = state.multiSelectMode ? state.selectedLayerIds : [ls.activeLayerId];
    const targets = selectedIds.map(id => ls.shapeById(id)).filter((layer): layer is NonNullable<typeof layer> => !!layer && (layer.shape.kind === 'rect' || layer.shape.kind === 'polygon'));
    if (!targets.length) return;
    const targetIds = new Set(targets.map(layer => layer.id));
    for (const target of targets) {
      let parent = target.parentId;
      while (parent) {
        if (targetIds.has(parent)) {
          useStore.getState().set({ toolNotice: '親子関係にある図形は同時に分断できません' });
          return;
        }
        parent = ls.byId(parent)?.parentId ?? null;
      }
    }
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < .01) return;
    const activeTool = state.tools.find(tool => tool.id === state.activeToolId);
    const widthMm = Math.max(0, normalizePolygonSplitToolSettings(activeTool?.settings).widthMm);
    const width = mmToPx(widthMm, useStore.getState().canvasSpec.ppi);
    eng.setBusy(true);
    try {
      const clipping = await import('polygon-clipping');
      const results: SplitResult[] = [];
      for (const layer of targets) {
        const points = shapePoints(layer.shape as TargetShape);
        const fragments = clipPolygonByBand(clipping, points, a, b, width, Math.max(eng.artboard.w, eng.artboard.h));
        const originalArea = Math.abs(polygonArea(points));
        const resultArea = fragments.reduce((sum, fragment) => sum + Math.abs(polygonArea(fragment)), 0);
        if (fragments.length === 1 && Math.abs(resultArea - originalArea) < .01) continue;
        results.push({ id: layer.id, fragments });
      }
      if (!results.length) return;
      await this.apply(results, selectionSnapshot(eng));
    } finally {
      eng.setBusy(false);
    }
  }

  private snapshotEntries(rootIds: string[]): LocatedLayerSnapshot[] {
    const ls = this.engine.layerService;
    return rootIds.flatMap(rootId => ls.descendantIds(rootId).map(id => ({
      location: ls.locationOf(id) ?? { parentId: ls.byId(id)?.parentId ?? null, index: 0 },
      snapshot: ls.snapshotLayer(ls.byId(id)!, true, true),
    })));
  }

  private cloneSubtree(
    source: LocatedLayerSnapshot[],
    rootId: string,
    shape: ShapeParams,
    name: string,
    location: { parentId: string | null; index: number },
  ): LocatedLayerSnapshot[] {
    const ids = new Map(source.map(entry => [entry.snapshot.id, newLayerId()]));
    return source.map(entry => {
      const original = entry.snapshot;
      const isRoot = original.id === rootId;
      const snapshot = {
        ...structuredClone({ ...original, canvas: undefined, blob: original.blob }),
        id: ids.get(original.id)!,
        name: isRoot ? name : original.name,
        parentId: isRoot ? location.parentId : original.parentId ? ids.get(original.parentId) ?? original.parentId : null,
        childIds: original.childIds.map(id => ids.get(id) ?? id),
        maskLayerIds: original.maskLayerIds?.map(id => ids.get(id) ?? id),
        shape: isRoot ? cloneShape(shape) : original.shape ? cloneShape(original.shape) : undefined,
        canvas: original.canvas,
      };
      return {
        location: isRoot ? location : { parentId: snapshot.parentId, index: entry.location.index },
        snapshot,
      };
    });
  }

  private async apply(results: SplitResult[], beforeSelection: LayerSelectionSnapshot): Promise<void> {
    const eng = this.engine, ls = eng.layerService;
    const rootIds = results.map(result => result.id);
    const beforeEntries = this.snapshotEntries(rootIds);
    const beforeByRoot = new Map(rootIds.map(id => [id, beforeEntries.filter(entry => id === entry.snapshot.id || ls.descendantIds(id).includes(entry.snapshot.id))]));
    const newRootIds: string[] = [];
    const maskChanges: NonNullable<LayerReplaceOp['maskChanges']> = [];
    const downstreamLinkOps: import('../history/historyTree').LayerLinkOp[] = [];
    const producedByOriginal = new Map<string, string[]>();
    for (const result of results) {
      const layer = ls.shapeById(result.id)!;
      const sourceEntries = beforeByRoot.get(result.id)!;
      const location = ls.locationOf(result.id)!;
      if (!result.fragments.length) {
        maskChanges.push(...ls.detachMaskReferences(new Set(ls.descendantIds(result.id))));
        ls.removeLayerInternal(result.id);
        producedByOriginal.set(result.id, []);
        continue;
      }
      const style = {
        color: layer.shape.color,
        strokeWidth: layer.shape.strokeWidth,
        paintMode: shapePaintMode(layer.shape),
        strokeJoin: layer.shape.strokeJoin,
        cornerRadius: layer.shape.kind === 'polygon' || layer.shape.kind === 'rect' ? layer.shape.cornerRadius : undefined,
      };
      const beforeShape = cloneShape(layer.shape);
      layer.shape = polygonFromWorldPoints(result.fragments[0], style);
      ls.linkOpForUserChange(layer, { shape: beforeShape }, { shape: cloneShape(layer.shape) });
      ls.bumpLayer(layer.id);
      newRootIds.push(layer.id);
      const produced = [layer.id];
      for (let i = 1; i < result.fragments.length; i++) {
        const fragment = polygonFromWorldPoints(result.fragments[i], style);
        const entries = this.cloneSubtree(sourceEntries, result.id, fragment, `${layer.name} ${i + 1}`, { parentId: location.parentId, index: location.index + i });
        await ls.restoreEntries(entries);
        const cloneId = entries[0].snapshot.id;
        const clone = ls.shapeById(cloneId);
        const originalShape = sourceEntries[0]?.snapshot.shape;
        if (clone && originalShape) ls.linkOpForUserChange(
          clone,
          { shape: cloneShape(originalShape) },
          { shape: cloneShape(clone.shape) },
        );
        produced.push(cloneId);
        newRootIds.push(cloneId);
      }
      producedByOriginal.set(result.id, produced);
      for (const producedId of produced) downstreamLinkOps.push(
        ...eng.links.propagateFrom({ pageId: eng.pages.activePageId, layerId: producedId }),
      );
    }
    const selected = beforeSelection.selectedLayerIds.flatMap(id => producedByOriginal.has(id) ? producedByOriginal.get(id)! : ls.byId(id) ? [id] : []);
    const primaryResults = producedByOriginal.get(beforeSelection.activeLayerId) ?? [];
    ls.activeLayerId = primaryResults[0] ?? (ls.byId(beforeSelection.activeLayerId) ? beforeSelection.activeLayerId : selected[0] ?? '');
    ls.fixActive();
    const afterSelection: LayerSelectionSnapshot = {
      activeLayerId: ls.activeLayerId,
      selectedLayerIds: selected.length ? selected : [ls.activeLayerId].filter(Boolean),
      multiSelectMode: beforeSelection.multiSelectMode || selected.length > 1,
    };
    useStore.getState().set({ selectedLayerIds: afterSelection.selectedLayerIds, multiSelectMode: afterSelection.multiSelectMode });
    const afterEntries = this.snapshotEntries(newRootIds);
    const side = (ids: string[], entries: LocatedLayerSnapshot[], selection: LayerSelectionSnapshot): LayerReplaceSide => ({ rootIds: ids, entries, selection });
    const op: LayerReplaceOp = {
      kind: 'layerReplace',
      before: side(rootIds, beforeEntries, beforeSelection),
      after: side(newRootIds, afterEntries, afterSelection),
      maskChanges,
    };
    eng.history.push(downstreamLinkOps.length ? { kind: 'batch', ops: [op, ...downstreamLinkOps] } : op, '多角形を分断');
    eng.committed();
  }
}
