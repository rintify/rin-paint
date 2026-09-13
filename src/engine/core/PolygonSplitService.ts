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
import { isLayerType } from '../../model';
import { layerDefinition } from '../layer-types/registry';
import type { LayerSnapshot } from '../layer-types/definition';
import type { ShapeState } from '../../model';
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
    const targets = selectedIds.map(id => ls.shapeById(id)).filter((layer): layer is NonNullable<typeof layer> => !!layer && (layer.state.shape.kind === 'rect' || layer.state.shape.kind === 'polygon'));
    if (!targets.length) return;
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < .01) return;
    const activeTool = state.tools.find(tool => tool.id === state.activeToolId);
    const widthMm = Math.max(0, normalizePolygonSplitToolSettings(activeTool?.settings).widthMm);
    const width = mmToPx(widthMm, useStore.getState().pageSpec.ppi);
    eng.setBusy(true);
    try {
      const clipping = await import('polygon-clipping');
      const results: SplitResult[] = [];
      for (const layer of targets) {
        const points = shapePoints(layer.state.shape as TargetShape);
        const fragments = clipPolygonByBand(clipping, points, a, b, width, Math.max(eng.pageFrame.w, eng.pageFrame.h));
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
      location: ls.locationOf(id) ?? { scopeId: ls.byId(id)?.scopeId ?? null, index: 0 },
      snapshot: ls.snapshotLayer(ls.byId(id)!, true, true),
    })));
  }

  private cloneSubtree(
    source: LocatedLayerSnapshot[],
    rootId: string,
    shape: ShapeParams,
    name: string,
    location: { scopeId: string | null; index: number },
  ): LocatedLayerSnapshot[] {
    const ids = new Map(source.map(entry => [entry.snapshot.id, newLayerId()]));
    return source.map(entry => {
      const original = entry.snapshot;
      const isRoot = original.id === rootId;
      const type = isLayerType(original.type) ? original.type : 'raster';
      const def = layerDefinition(type);
      const decoded = def.codec.decode(original.state) ?? def.state.initial();
      const remapped = def.state.remapReferences
        ? def.state.remapReferences(decoded as never, id => ids.get(id) ?? id)
        : decoded;
      const nextState = isRoot && type === 'shape'
        ? { ...(remapped as ShapeState), shape: cloneShape(shape) }
        : remapped;
      const snapshot: LayerSnapshot = {
        id: ids.get(original.id)!,
        type,
        common: {
          ...structuredClone(original.common),
          name: isRoot ? name : original.common.name,
        },
        placement: {
          scopeId: isRoot
            ? location.scopeId
            : original.placement?.scopeId
              ? ids.get(original.placement.scopeId) ?? original.placement.scopeId
              : null,
          scopeLayerIds: (original.placement?.scopeLayerIds ?? []).map(id => ids.get(id) ?? id),
        },
        state: def.codec.encode(nextState as never),
        content: original.content,
        canvas: original.canvas,
      };
      return {
        location: isRoot ? location : { scopeId: snapshot.placement?.scopeId ?? null, index: entry.location.index },
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
        color: layer.state.shape.color,
        strokeWidth: layer.state.shape.strokeWidth,
        paintMode: shapePaintMode(layer.state.shape),
        strokeJoin: layer.state.shape.strokeJoin,
        cornerRadius: layer.state.shape.kind === 'polygon' || layer.state.shape.kind === 'rect' ? layer.state.shape.cornerRadius : undefined,
      };
      const beforeShape = cloneShape(layer.state.shape);
      layer.state.shape = polygonFromWorldPoints(result.fragments[0], style);
      ls.linkOpForUserChange(layer, { state: { shape: beforeShape } }, { state: { shape: cloneShape(layer.state.shape) } });
      ls.bumpLayer(layer.id);
      newRootIds.push(layer.id);
      const produced = [layer.id];
      for (let i = 1; i < result.fragments.length; i++) {
        const fragment = polygonFromWorldPoints(result.fragments[i], style);
        const entries = this.cloneSubtree(sourceEntries, result.id, fragment, `${layer.name} ${i + 1}`, { scopeId: location.scopeId, index: location.index + i });
        await ls.restoreEntries(entries);
        const cloneId = entries[0].snapshot.id;
        const clone = ls.shapeById(cloneId);
        const originalState = sourceEntries[0]?.snapshot.state as ShapeState | undefined;
        if (clone && originalState) ls.linkOpForUserChange(
          clone,
          { state: { shape: cloneShape(originalState.shape) } },
          { state: { shape: cloneShape(clone.state.shape) } },
        );
        produced.push(cloneId);
        newRootIds.push(cloneId);
      }
      producedByOriginal.set(result.id, produced);
      for (const producedId of produced) downstreamLinkOps.push(
        ...eng.links.propagateFrom(eng.layerAddress(producedId)),
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
