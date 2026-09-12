import { useStore } from '../../state/store';
import type { ShapeParams, ShapePoint, StrokePoint } from '../../model';
import {
  cloneShape,
  rotateShape,
  shapeBounds,
  shapeCenter,
  shapeKindHandler,
  shapePoints,
  shapeRotation,
  translateShape,
  type ShapeEditMode,
} from '../shapes';
import {
  collectSnapLines,
  constrainVertexToEdges,
  snapAngleToRightAngles,
  snapPointToPoints,
  snapTranslation,
  type SnapLines,
} from '../shapes/snap';
import type { PaintEngine } from '../PaintEngine';
import { unionRect, type DirtyRect } from '../brush';

interface VertexWorld {
  prev: ShapePoint;
  selected: ShapePoint;
  next: ShapePoint;
}

interface ShapeEdit {
  layerId: string;
  mode: ShapeEditMode;
  start: StrokePoint;
  before: ShapeParams;
  vertexIndex?: number;
  invalid?: boolean;
  lastValid?: ShapeParams;
  snapLines?: SnapLines;
  xGuide: number | null;
  yGuide: number | null;
  vertexWorld?: VertexWorld;
  vertexSnapPoints?: ShapePoint[];
  snappedPoint?: ShapePoint | null;
}

/** 回転ハンドルは外接矩形の上辺からこれだけ離す (画面 px) */
const ROTATE_HANDLE_GAP = 28;
const HANDLE_RADIUS = 11;
const SNAP_SCREEN_PX = 8;

function shapeDirty(shape: ShapeParams): DirtyRect {
  const bounds = shapeBounds(shape);
  const pad = Math.max(3, shape.strokeWidth / 2 + 2);
  return {
    minX: bounds.x - pad,
    minY: bounds.y - pad,
    maxX: bounds.x + bounds.w + pad,
    maxY: bounds.y + bounds.h + pad,
  };
}

export class ShapeEditController {
  private shapeEdit: ShapeEdit | null = null;
  private selectedHandle: { layerId: string; mode: ShapeEditMode; index?: number } | null = null;

  constructor(private engine: PaintEngine) {}

  hasEdit(): boolean { return !!this.shapeEdit; }

  snapGuides(): { x: number | null; y: number | null } {
    return { x: this.shapeEdit?.xGuide ?? null, y: this.shapeEdit?.yGuide ?? null };
  }

  refreshVertexState(): void {
    this.syncVertexState();
  }

  setShapeHandleEdgeConstrained(value: boolean): void {
    if (value && !this.selectedHandle) value = false;
    useStore.getState().set({ shapeHandleEdgeConstrained: value });
  }

  private syncVertexState(): void {
    const selected = this.selectedHandle;
    const layer = selected ? this.engine.layerService.shapeById(selected.layerId) : null;
    const vertices = layer ? shapeKindHandler(layer.shape).edit.vertexCount(layer.shape) : 0;
    const valid = !!layer
      && selected!.layerId === this.engine.layerService.activeLayerId
      && (selected!.mode === 'vertex'
        ? selected!.index !== undefined && selected!.index < vertices
        : layer.shape.kind === 'rect' || layer.shape.kind === 'ellipse');
    if (!valid) this.selectedHandle = null;
    useStore.getState().set({
      shapeHandleSelected: valid,
      shapeHandleCanDelete: valid && selected?.mode === 'vertex' && vertices > 3,
      shapeHandleIsVertex: valid && selected?.mode === 'vertex',
      shapeHandleEdgeConstrained: valid ? useStore.getState().shapeHandleEdgeConstrained : false,
    });
  }

  /** 外接矩形の上に浮かぶ回転ハンドルの位置。種類によらず共通 */
  private rotateHandle(shape: ShapeParams): { x: number; y: number } {
    return { x: shapeCenter(shape).x, y: shapeBounds(shape).y - ROTATE_HANDLE_GAP * this.engine.uiScale() };
  }

  private collectMoveSnapLines(editingId: string): SnapLines {
    const others = this.engine.layerService.layers.flatMap(layer => {
      if (layer.id === editingId || layer.type !== 'shape' || !layer.visible) return [];
      return [shapeBounds(layer.shape)];
    });
    return collectSnapLines(this.engine.artboard, others);
  }

  private collectVertexSnapPoints(editingId: string, selectedIndex: number): ShapePoint[] {
    return this.engine.layerService.layers.flatMap(layer => {
      if (layer.type !== 'shape' || !layer.visible || layer.shape.kind !== 'polygon') return [];
      return shapePoints(layer.shape).filter((_, index) => layer.id !== editingId || index !== selectedIndex);
    });
  }

  private clearGuides(edit: ShapeEdit): void {
    edit.xGuide = null;
    edit.yGuide = null;
  }

  beginShapeEdit(point: StrokePoint, _event?: PointerEvent): boolean {
    const layer = this.engine.layerService.shapeById(this.engine.layerService.activeLayerId);
    if (!layer) { this.selectedHandle = null; this.syncVertexState(); return false; }
    const shape = layer.shape;
    const edit = shapeKindHandler(shape).edit;
    const radius = HANDLE_RADIUS * this.engine.uiScale();
    const near = (x: number, y: number) => Math.hypot(point.x - x, point.y - y) <= radius;

    const rotate = this.rotateHandle(shape);
    const hit = near(rotate.x, rotate.y)
      ? { mode: 'rotate' as ShapeEditMode, vertexIndex: undefined, shape: undefined }
      : edit.hitHandle(shape, { point, near });
    const mode = hit?.mode ?? (edit.containsPoint(shape, point, radius) ? 'move' : null);
    if (!mode) return false;

    const before = cloneShape(shape);
    /** 辺の中点を掴んだときのように、ヒットと同時に図形が変わる場合 */
    if (hit?.shape) layer.shape = hit.shape;

    const cornerIndex = ({ nw: 0, ne: 1, se: 2, sw: 3 } as Partial<Record<ShapeEditMode, number>>)[mode];
    if (mode === 'vertex') this.selectedHandle = { layerId: layer.id, mode, index: hit!.vertexIndex! };
    else if (cornerIndex !== undefined && (shape.kind === 'rect' || shape.kind === 'ellipse')) this.selectedHandle = { layerId: layer.id, mode, index: cornerIndex };
    else if (mode !== 'rotate') this.selectedHandle = null;

    let vertexWorld: VertexWorld | undefined;
    const handleIndex = mode === 'vertex' ? hit?.vertexIndex : cornerIndex;
    if (handleIndex !== undefined && (mode === 'vertex' || shape.kind === 'rect' || shape.kind === 'ellipse')) {
      const world = shapePoints(layer.shape);
      const count = world.length;
      const index = handleIndex;
      vertexWorld = {
        prev: world[(index - 1 + count) % count],
        selected: world[index],
        next: world[(index + 1) % count],
      };
    }

    this.shapeEdit = {
      layerId: layer.id,
      mode,
      start: point,
      before,
      vertexIndex: hit?.vertexIndex,
      lastValid: cloneShape(layer.shape),
      snapLines: mode === 'move' ? this.collectMoveSnapLines(layer.id) : undefined,
      xGuide: null,
      yGuide: null,
      vertexWorld,
      vertexSnapPoints: mode === 'vertex' && hit?.vertexIndex !== undefined
        ? this.collectVertexSnapPoints(layer.id, hit.vertexIndex)
        : undefined,
      snappedPoint: null,
    };
    this.syncVertexState();
    if (hit?.shape) {
      this.engine.invalidateLayer(layer.id, unionRect(shapeDirty(before), shapeDirty(layer.shape)));
      this.engine.requestOverlayRender();
      this.engine.syncStore();
    }
    return true;
  }

  updateShapeEdit(point: StrokePoint, event?: PointerEvent): boolean {
    const edit = this.shapeEdit;
    if (!edit) return false;
    const layer = this.engine.layerService.shapeById(edit.layerId);
    if (!layer) {
      this.shapeEdit = null;
      this.engine.requestRender();
      this.engine.syncStore();
      return false;
    }
    let next: ShapeParams = cloneShape(edit.before);
    this.clearGuides(edit);
    edit.snappedPoint = null;
    if (edit.mode === 'move') {
      const dx = point.x - edit.start.x;
      const dy = point.y - edit.start.y;
      if (!layer.snapEnabled) {
        next = translateShape(edit.before, dx, dy);
      } else {
        const snapped = snapTranslation(
          shapeBounds(edit.before),
          dx,
          dy,
          edit.snapLines ?? collectSnapLines(this.engine.artboard, []),
          SNAP_SCREEN_PX * this.engine.uiScale(),
        );
        next = translateShape(edit.before, snapped.dx, snapped.dy);
        edit.xGuide = snapped.xGuide;
        edit.yGuide = snapped.yGuide;
      }
    } else if (edit.mode === 'rotate') {
      const center = shapeCenter(edit.before);
      const initial = Math.atan2(edit.start.y - center.y, edit.start.x - center.x);
      const rawDelta = Math.atan2(point.y - center.y, point.x - center.x) - initial;
      if (!layer.snapEnabled) {
        next = rotateShape(edit.before, rawDelta);
      } else {
        const startAbs = shapeRotation(edit.before);
        const snapped = snapAngleToRightAngles(startAbs + rawDelta);
        next = rotateShape(edit.before, snapped.angle - startAbs);
      }
    } else {
      let target = point;
      if (edit.vertexWorld && ((event?.shiftKey ?? false) || useStore.getState().shapeHandleEdgeConstrained)) {
        const constrained = constrainVertexToEdges(point, edit.vertexWorld.prev, edit.vertexWorld.selected, edit.vertexWorld.next);
        target = { ...point, x: constrained.x, y: constrained.y };
      }
      if (edit.mode === 'vertex' && layer.snapEnabled && edit.vertexSnapPoints) {
        const snapped = snapPointToPoints(target, edit.vertexSnapPoints, SNAP_SCREEN_PX * this.engine.uiScale());
        target = { ...target, x: snapped.point.x, y: snapped.point.y };
        edit.snappedPoint = snapped.snappedTo;
      }
      const result = shapeKindHandler(edit.before).edit.dragHandle({
        mode: edit.mode,
        before: edit.before,
        current: layer.shape,
        vertexIndex: edit.vertexIndex,
        point: target,
      });
      if (result) {
        next = result.shape;
        if (result.invalid !== undefined) {
          edit.invalid = result.invalid;
          if (!result.invalid) edit.lastValid = cloneShape(next);
        }
      }
    }
    const previous = layer.shape;
    layer.shape = next;
    this.syncVertexState();
    this.engine.invalidateLayer(layer.id, unionRect(shapeDirty(previous), shapeDirty(next)));
    this.engine.requestOverlayRender();
    this.engine.syncStore();
    return true;
  }

  finishShapeEdit(_point: StrokePoint): boolean {
    const edit = this.shapeEdit;
    if (!edit) return false;
    this.shapeEdit = null;
    const layer = this.engine.layerService.shapeById(edit.layerId);
    if (layer && edit.invalid) {
      layer.shape = cloneShape(edit.lastValid ?? edit.before);
      this.engine.notify(shapeKindHandler(layer.shape).edit.invalidMessage ?? '直前の有効な状態へ戻しました');
      this.engine.invalidateLayer(layer.id, unionRect(shapeDirty(edit.before), shapeDirty(layer.shape)));
      this.engine.requestOverlayRender();
      this.engine.syncStore();
    }
    if (layer && JSON.stringify(layer.shape) !== JSON.stringify(edit.before)) {
      this.engine.history.push({ kind: 'layerProps', layerId: layer.id, before: { shape: cloneShape(edit.before) }, after: { shape: cloneShape(layer.shape) } }, edit.vertexIndex !== undefined ? '多角形の頂点を編集' : '図形を編集');
      this.engine.committed(false);
    } else {
      this.engine.requestOverlayRender();
    }
    this.syncVertexState();
    return true;
  }

  deleteSelectedVertex(): void {
    const selected = this.selectedHandle;
    const layer = selected ? this.engine.layerService.shapeById(selected.layerId) : null;
    if (!selected || selected.mode !== 'vertex' || selected.index === undefined || !layer) return;
    const before = cloneShape(layer.shape);
    const result = shapeKindHandler(before).edit.deleteVertex(before, selected.index);
    if (!result) return;
    if (!result.shape) { if (result.error) this.engine.notify(result.error); return; }
    this.engine.layerService.assignProps(layer, { shape: result.shape });
    this.selectedHandle = null;
    this.syncVertexState();
    this.engine.history.push({ kind: 'layerProps', layerId: layer.id, before: { shape: before }, after: { shape: cloneShape(layer.shape) } }, '多角形の頂点を削除');
    this.engine.committed();
  }

  cancelShapeEdit(): void {
    const edit = this.shapeEdit;
    if (!edit) return;
    const layer = this.engine.layerService.shapeById(edit.layerId);
    const previous = layer ? cloneShape(layer.shape) : null;
    if (layer) layer.shape = edit.before;
    this.shapeEdit = null;
    this.syncVertexState();
    if (layer && previous) this.engine.invalidateLayer(layer.id, unionRect(shapeDirty(previous), shapeDirty(layer.shape)));
    this.engine.requestOverlayRender();
    this.engine.syncStore();
  }

  drawActiveShapeHandles(ctx: CanvasRenderingContext2D): void {
    const layer = this.engine.layerService.shapeById(this.engine.layerService.activeLayerId);
    if (!layer) { if (this.selectedHandle) { this.selectedHandle = null; this.syncVertexState(); } return; }
    if (this.selectedHandle && this.selectedHandle.layerId !== layer.id) {
      this.selectedHandle = null;
      this.syncVertexState();
    }
    const shape = layer.shape, bounds = shapeBounds(shape), scale = this.engine.uiScale(), center = shapeCenter(shape);
    const invalid = !!this.shapeEdit?.invalid;
    const points = shapePoints(shape);
    const insertions = shapeKindHandler(shape).edit.insertionPoints(shape);
    const rotateHandle = this.rotateHandle(shape);
    ctx.save();
    const xGuide = this.shapeEdit?.xGuide;
    const yGuide = this.shapeEdit?.yGuide;
    if (xGuide !== null && xGuide !== undefined || yGuide !== null && yGuide !== undefined) {
      ctx.strokeStyle = '#4f8cff';
      ctx.lineWidth = scale;
      ctx.setLineDash([6 * scale, 4 * scale]);
      if (xGuide !== null && xGuide !== undefined) {
        ctx.beginPath();
        ctx.moveTo(xGuide, 0);
        ctx.lineTo(xGuide, this.engine.artboard.h);
        ctx.stroke();
      }
      if (yGuide !== null && yGuide !== undefined) {
        ctx.beginPath();
        ctx.moveTo(0, yGuide);
        ctx.lineTo(this.engine.artboard.w, yGuide);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    const snappedPoint = this.shapeEdit?.snappedPoint;
    if (snappedPoint) {
      ctx.strokeStyle = '#4f8cff';
      ctx.fillStyle = '#4f8cff33';
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.arc(snappedPoint.x, snappedPoint.y, 8 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.strokeStyle = invalid ? '#e53935' : '#4f8cff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5 * scale;
    if (invalid) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index++) ctx.lineTo(points[index].x, points[index].y);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.setLineDash([4 * scale, 3 * scale]); ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h); ctx.setLineDash([]);
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      ctx.fillStyle = this.selectedHandle?.layerId === layer.id && this.selectedHandle.index === index ? '#4f8cff' : '#fff';
      ctx.beginPath(); ctx.rect(point.x - 4 * scale, point.y - 4 * scale, 8 * scale, 8 * scale); ctx.fill(); ctx.stroke();
      const insertion = insertions[index];
      if (!insertion) continue;
      const { x, y } = insertion;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 4 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 2 * scale, y); ctx.lineTo(x + 2 * scale, y); ctx.moveTo(x, y - 2 * scale); ctx.lineTo(x, y + 2 * scale); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(center.x, bounds.y); ctx.lineTo(rotateHandle.x, rotateHandle.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(rotateHandle.x, rotateHandle.y, 5 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const arm = 8 * scale;
    const drawCenter = () => {
      ctx.beginPath();
      ctx.moveTo(center.x - arm, center.y); ctx.lineTo(center.x + arm, center.y);
      ctx.moveTo(center.x, center.y - arm); ctx.lineTo(center.x, center.y + arm);
      ctx.stroke();
    };
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * scale; drawCenter();
    ctx.strokeStyle = invalid ? '#e53935' : '#4f8cff'; ctx.lineWidth = 1.5 * scale; drawCenter();
    ctx.restore();
  }
}
