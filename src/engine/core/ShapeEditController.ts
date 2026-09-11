import { useStore } from '../../state/store';
import type { ShapeParams, StrokePoint } from '../../model';
import {
  cloneShape,
  pointInPolygon,
  polygonSelfIntersects,
  shapeBounds,
  shapeCenter,
  shapeCorners,
  shapeWorldPoints,
  rotateShape,
  translateShape,
} from '../shapes';
import type { PaintEngine } from '../PaintEngine';

interface ShapeEdit {
  layerId: string;
  mode: 'move' | 'rotate' | 'start' | 'end' | 'nw' | 'ne' | 'sw' | 'se' | 'vertex';
  start: StrokePoint;
  before: ShapeParams;
  vertexIndex?: number;
  invalid?: boolean;
  lastValid?: ShapeParams;
}

export class ShapeEditController {
  private shapeEdit: ShapeEdit | null = null;
  private selectedVertex: { layerId: string; index: number } | null = null;

  constructor(private engine: PaintEngine) {}

  hasEdit(): boolean { return !!this.shapeEdit; }

  private syncVertexState(): void {
    const selected = this.selectedVertex;
    const layer = selected ? this.engine.layerService.shapeById(selected.layerId) : null;
    const valid = !!layer
      && selected!.layerId === this.engine.layerService.activeLayerId
      && layer.shape.kind === 'polygon'
      && selected!.index < layer.shape.points.length;
    if (!valid) this.selectedVertex = null;
    useStore.getState().set({
      polygonVertexSelected: valid,
      polygonVertexCanDelete: valid && layer!.shape.kind === 'polygon' && layer!.shape.points.length > 3,
    });
  }

  beginShapeEdit(point: StrokePoint, _event?: PointerEvent): boolean {
    const layer = this.engine.layerService.shapeById(this.engine.layerService.activeLayerId);
    if (!layer) { this.selectedVertex = null; this.syncVertexState(); return false; }
    const shape = layer.shape;
    const radius = 11 * this.engine.uiScale();
    const near = (x: number, y: number) => Math.hypot(point.x - x, point.y - y) <= radius;
    let mode: ShapeEdit['mode'] | null = null;
    let vertexIndex: number | undefined;
    const center = shapeCenter(shape), bounds = shapeBounds(shape);
    if (near(center.x, bounds.y - 28 * this.engine.uiScale())) mode = 'rotate';
    if (!mode && shape.kind === 'line') {
      if (near(shape.x1, shape.y1)) mode = 'start';
      else if (near(shape.x2, shape.y2)) mode = 'end';
    } else if (!mode && shape.kind === 'polygon') {
      const points = shapeWorldPoints(shape);
      const hit = points.findIndex(value => near(value.x, value.y));
      if (hit >= 0) { mode = 'vertex'; vertexIndex = hit; }
      if (!mode) {
        const midpoint = points.findIndex((value, index) => {
          const next = points[(index + 1) % points.length];
          return near((value.x + next.x) / 2, (value.y + next.y) / 2);
        });
        if (midpoint >= 0) {
          const before = cloneShape(shape);
          const a = shape.points[midpoint], b = shape.points[(midpoint + 1) % shape.points.length];
          const index = midpoint + 1;
          layer.shape = { ...shape, points: [...shape.points.slice(0, index), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ...shape.points.slice(index)] };
          this.selectedVertex = { layerId: layer.id, index };
          this.shapeEdit = { layerId: layer.id, mode: 'vertex', start: point, before, vertexIndex: index, lastValid: cloneShape(layer.shape) };
          this.syncVertexState();
          this.engine.requestRender(); this.engine.syncStore();
          return true;
        }
      }
    } else if (!mode && shape.kind !== 'line' && shape.kind !== 'polygon') {
      const points = shapeCorners(shape);
      const corners = [['nw', points[0].x, points[0].y], ['ne', points[1].x, points[1].y], ['se', points[2].x, points[2].y], ['sw', points[3].x, points[3].y]] as const;
      mode = corners.find(([, x, y]) => near(x, y))?.[0] ?? null;
    }
    const inside = shape.kind === 'polygon'
      ? pointInPolygon(point, shapeWorldPoints(shape))
      : point.x >= bounds.x - radius && point.x <= bounds.x + bounds.w + radius && point.y >= bounds.y - radius && point.y <= bounds.y + bounds.h + radius;
    if (!mode && inside) mode = 'move';
    if (!mode) return false;
    if (shape.kind === 'polygon' && mode === 'vertex') this.selectedVertex = { layerId: layer.id, index: vertexIndex! };
    else if (mode !== 'rotate') this.selectedVertex = null;
    this.syncVertexState();
    const before = cloneShape(shape);
    this.shapeEdit = { layerId: layer.id, mode, start: point, before, vertexIndex, lastValid: cloneShape(before) };
    return true;
  }

  updateShapeEdit(point: StrokePoint, _event?: PointerEvent): boolean {
    const edit = this.shapeEdit;
    if (!edit) return false;
    const layer = this.engine.layerService.shapeById(edit.layerId);
    if (!layer) return false;
    const dx = point.x - edit.start.x, dy = point.y - edit.start.y;
    let next: ShapeParams = cloneShape(edit.before);
    if (edit.mode === 'move') next = translateShape(edit.before, dx, dy);
    else if (edit.mode === 'rotate') {
      const center = shapeCenter(edit.before);
      const initial = Math.atan2(edit.start.y - center.y, edit.start.x - center.x);
      next = rotateShape(edit.before, Math.atan2(point.y - center.y, point.x - center.x) - initial);
    } else if (edit.before.kind === 'line') {
      next = edit.mode === 'start' ? { ...edit.before, x1: point.x, y1: point.y } : { ...edit.before, x2: point.x, y2: point.y };
    } else if (edit.before.kind === 'polygon' && edit.mode === 'vertex') {
      const current = layer.shape.kind === 'polygon' ? cloneShape(layer.shape) : cloneShape(edit.before);
      const angle = -(current.rotation ?? 0), dx = point.x - current.cx, dy = point.y - current.cy;
      current.points[edit.vertexIndex!] = { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: dx * Math.sin(angle) + dy * Math.cos(angle) };
      edit.invalid = polygonSelfIntersects(current.points);
      if (!edit.invalid) edit.lastValid = cloneShape(current);
      next = current;
    } else if (edit.before.kind !== 'polygon') {
      const center = shapeCenter(edit.before);
      const angle = edit.before.rotation ?? 0, cos = Math.cos(-angle), sin = Math.sin(-angle);
      const px = (point.x - center.x) * cos - (point.y - center.y) * sin;
      const py = (point.x - center.x) * sin + (point.y - center.y) * cos;
      const hw = edit.before.kind === 'rect' ? edit.before.width / 2 : edit.before.rx;
      const hh = edit.before.kind === 'rect' ? edit.before.height / 2 : edit.before.ry;
      const left = edit.mode.endsWith('w') ? px : -hw, right = edit.mode.endsWith('e') ? px : hw;
      const top = edit.mode.startsWith('n') ? py : -hh, bottom = edit.mode.startsWith('s') ? py : hh;
      const localX = (left + right) / 2, localY = (top + bottom) / 2;
      const worldX = center.x + localX * Math.cos(angle) - localY * Math.sin(angle);
      const worldY = center.y + localX * Math.sin(angle) + localY * Math.cos(angle);
      const w = Math.max(.01, Math.abs(right - left)), h = Math.max(.01, Math.abs(bottom - top));
      next = edit.before.kind === 'rect'
        ? { ...edit.before, x: worldX - w / 2, y: worldY - h / 2, width: w, height: h }
        : { ...edit.before, cx: worldX, cy: worldY, rx: w / 2, ry: h / 2 };
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
      this.engine.notify('自己交差する位置は使えないため、直前の有効位置へ戻しました');
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
    if (!selected || !layer || layer.shape.kind !== 'polygon' || layer.shape.points.length <= 3) return;
    const before = cloneShape(layer.shape);
    const points = before.points.filter((_, index) => index !== selected.index);
    if (polygonSelfIntersects(points)) { this.engine.notify('自己交差するためこの頂点は削除できません'); return; }
    layer.shape = { ...before, points };
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
    const points = shape.kind === 'line' ? [{ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }]
      : shape.kind === 'polygon' ? shapeWorldPoints(shape) : shapeCorners(shape);
    const rotateHandle = { x: center.x, y: bounds.y - 28 * scale };
    ctx.save();
    ctx.strokeStyle = this.shapeEdit?.invalid ? '#e53935' : '#4f8cff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5 * scale;
    if (shape.kind === 'polygon' && this.shapeEdit?.invalid) {
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
      if (shape.kind === 'polygon') {
        const next = points[(index + 1) % points.length], mx = (point.x + next.x) / 2, my = (point.y + next.y) / 2;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(mx, my, 4 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(mx - 2 * scale, my); ctx.lineTo(mx + 2 * scale, my); ctx.moveTo(mx, my - 2 * scale); ctx.lineTo(mx, my + 2 * scale); ctx.stroke();
      }
    }
    ctx.beginPath(); ctx.moveTo(center.x, bounds.y); ctx.lineTo(rotateHandle.x, rotateHandle.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(rotateHandle.x, rotateHandle.y, 5 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
