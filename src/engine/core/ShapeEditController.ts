import { useStore } from '../../state/store';
import type { ShapeParams, StrokePoint } from '../../model';
import {
  cloneShape,
  rotateShape,
  shapeBounds,
  shapeCenter,
  shapeKindHandler,
  shapePoints,
  translateShape,
  type ShapeEditMode,
} from '../shapes';
import type { PaintEngine } from '../PaintEngine';

interface ShapeEdit {
  layerId: string;
  mode: ShapeEditMode;
  start: StrokePoint;
  before: ShapeParams;
  vertexIndex?: number;
  invalid?: boolean;
  lastValid?: ShapeParams;
}

/** 回転ハンドルは外接矩形の上辺からこれだけ離す (画面 px) */
const ROTATE_HANDLE_GAP = 28;
const HANDLE_RADIUS = 11;

export class ShapeEditController {
  private shapeEdit: ShapeEdit | null = null;
  private selectedVertex: { layerId: string; index: number } | null = null;

  constructor(private engine: PaintEngine) {}

  hasEdit(): boolean { return !!this.shapeEdit; }

  private syncVertexState(): void {
    const selected = this.selectedVertex;
    const layer = selected ? this.engine.layerService.shapeById(selected.layerId) : null;
    const vertices = layer ? shapeKindHandler(layer.shape).edit.vertexCount(layer.shape) : 0;
    const valid = !!layer
      && selected!.layerId === this.engine.layerService.activeLayerId
      && selected!.index < vertices;
    if (!valid) this.selectedVertex = null;
    useStore.getState().set({
      polygonVertexSelected: valid,
      polygonVertexCanDelete: valid && vertices > 3,
    });
  }

  /** 外接矩形の上に浮かぶ回転ハンドルの位置。種類によらず共通 */
  private rotateHandle(shape: ShapeParams): { x: number; y: number } {
    return { x: shapeCenter(shape).x, y: shapeBounds(shape).y - ROTATE_HANDLE_GAP * this.engine.uiScale() };
  }

  beginShapeEdit(point: StrokePoint, _event?: PointerEvent): boolean {
    const layer = this.engine.layerService.shapeById(this.engine.layerService.activeLayerId);
    if (!layer) { this.selectedVertex = null; this.syncVertexState(); return false; }
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

    if (mode === 'vertex') this.selectedVertex = { layerId: layer.id, index: hit!.vertexIndex! };
    else if (mode !== 'rotate') this.selectedVertex = null;

    this.shapeEdit = {
      layerId: layer.id,
      mode,
      start: point,
      before,
      vertexIndex: hit?.vertexIndex,
      lastValid: cloneShape(layer.shape),
    };
    this.syncVertexState();
    if (hit?.shape) { this.engine.requestRender(); this.engine.syncStore(); }
    return true;
  }

  updateShapeEdit(point: StrokePoint, _event?: PointerEvent): boolean {
    const edit = this.shapeEdit;
    if (!edit) return false;
    const layer = this.engine.layerService.shapeById(edit.layerId);
    if (!layer) return false;
    let next: ShapeParams = cloneShape(edit.before);
    if (edit.mode === 'move') {
      next = translateShape(edit.before, point.x - edit.start.x, point.y - edit.start.y);
    } else if (edit.mode === 'rotate') {
      const center = shapeCenter(edit.before);
      const initial = Math.atan2(edit.start.y - center.y, edit.start.x - center.x);
      next = rotateShape(edit.before, Math.atan2(point.y - center.y, point.x - center.x) - initial);
    } else {
      const result = shapeKindHandler(edit.before).edit.dragHandle({
        mode: edit.mode,
        before: edit.before,
        current: layer.shape,
        vertexIndex: edit.vertexIndex,
        point,
      });
      if (result) {
        next = result.shape;
        if (result.invalid !== undefined) {
          edit.invalid = result.invalid;
          if (!result.invalid) edit.lastValid = cloneShape(next);
        }
      }
    }
    layer.shape = next;
    this.syncVertexState();
    this.engine.requestRender(); this.engine.syncStore();
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
      this.engine.requestRender(); this.engine.syncStore();
    }
    if (layer && JSON.stringify(layer.shape) !== JSON.stringify(edit.before)) {
      this.engine.history.push({ kind: 'layerProps', layerId: layer.id, before: { shape: cloneShape(edit.before) }, after: { shape: cloneShape(layer.shape) } }, edit.vertexIndex !== undefined ? '多角形の頂点を編集' : '図形を編集');
      this.engine.committed();
    }
    this.syncVertexState();
    return true;
  }

  deleteSelectedVertex(): void {
    const selected = this.selectedVertex;
    const layer = selected ? this.engine.layerService.shapeById(selected.layerId) : null;
    if (!selected || !layer) return;
    const before = cloneShape(layer.shape);
    const result = shapeKindHandler(before).edit.deleteVertex(before, selected.index);
    if (!result) return;
    if (!result.shape) { if (result.error) this.engine.notify(result.error); return; }
    layer.shape = result.shape;
    this.selectedVertex = null;
    this.syncVertexState();
    this.engine.history.push({ kind: 'layerProps', layerId: layer.id, before: { shape: before }, after: { shape: cloneShape(layer.shape) } }, '多角形の頂点を削除');
    this.engine.committed();
  }

  cancelShapeEdit(): void {
    const edit = this.shapeEdit;
    if (!edit) return;
    const layer = this.engine.layerService.shapeById(edit.layerId);
    if (layer) layer.shape = edit.before;
    this.shapeEdit = null;
    this.syncVertexState();
    this.engine.requestRender(); this.engine.syncStore();
  }

  drawActiveShapeHandles(ctx: CanvasRenderingContext2D): void {
    const layer = this.engine.layerService.shapeById(this.engine.layerService.activeLayerId);
    if (!layer) { if (this.selectedVertex) { this.selectedVertex = null; this.syncVertexState(); } return; }
    if (this.selectedVertex && this.selectedVertex.layerId !== layer.id) {
      this.selectedVertex = null;
      this.syncVertexState();
    }
    const shape = layer.shape, bounds = shapeBounds(shape), scale = this.engine.uiScale(), center = shapeCenter(shape);
    const invalid = !!this.shapeEdit?.invalid;
    const points = shapePoints(shape);
    const insertions = shapeKindHandler(shape).edit.insertionPoints(shape);
    const rotateHandle = this.rotateHandle(shape);
    ctx.save();
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
      ctx.fillStyle = this.selectedVertex?.layerId === layer.id && this.selectedVertex.index === index ? '#4f8cff' : '#fff';
      ctx.beginPath(); ctx.rect(point.x - 4 * scale, point.y - 4 * scale, 8 * scale, 8 * scale); ctx.fill(); ctx.stroke();
      const insertion = insertions[index];
      if (!insertion) continue;
      const { x, y } = insertion;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 4 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 2 * scale, y); ctx.lineTo(x + 2 * scale, y); ctx.moveTo(x, y - 2 * scale); ctx.lineTo(x, y + 2 * scale); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(center.x, bounds.y); ctx.lineTo(rotateHandle.x, rotateHandle.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(rotateHandle.x, rotateHandle.y, 5 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
