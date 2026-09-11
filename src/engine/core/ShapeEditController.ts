import type { ShapeParams, StrokePoint } from '../../model';
import { shapeBounds, shapeCenter, shapeCorners, rotateShape, translateShape } from '../shapes';
import type { PaintEngine } from '../PaintEngine';

interface ShapeEdit {
  layerId: string;
  mode: 'move' | 'rotate' | 'start' | 'end' | 'nw' | 'ne' | 'sw' | 'se';
  start: StrokePoint;
  before: ShapeParams;
}

/** Interactive shape handle editing. */
export class ShapeEditController {
  private shapeEdit: ShapeEdit | null = null;

  constructor(private engine: PaintEngine) {}

  hasEdit(): boolean {
    return !!this.shapeEdit;
  }

  beginShapeEdit(point: StrokePoint, _event?: PointerEvent): boolean {
    const layer = this.engine.layerService.shapeById(this.engine.layerService.activeLayerId);
    if (!layer) return false;
    const shape = layer.shape;
    const radius = 11 * this.engine.uiScale();
    const near = (x: number, y: number) => Math.hypot(point.x - x, point.y - y) <= radius;
    let mode: ShapeEdit['mode'] | null = null;
    const center = shapeCenter(shape);
    const bounds = shapeBounds(shape);
    if (near(center.x, bounds.y - 28 * this.engine.uiScale())) mode = 'rotate';
    if (!mode && shape.kind === 'line') {
      if (near(shape.x1, shape.y1)) mode = 'start';
      else if (near(shape.x2, shape.y2)) mode = 'end';
    } else if (!mode && shape.kind !== 'line') {
      const points = shapeCorners(shape);
      const corners = [['nw', points[0].x, points[0].y], ['ne', points[1].x, points[1].y], ['se', points[2].x, points[2].y], ['sw', points[3].x, points[3].y]] as const;
      mode = corners.find(([, x, y]) => near(x, y))?.[0] ?? null;
    }
    const b = shapeBounds(shape);
    const inside = point.x >= b.x - radius && point.x <= b.x + b.w + radius && point.y >= b.y - radius && point.y <= b.y + b.h + radius;
    if (!mode && inside) mode = 'move';
    if (!mode) return false;
    this.shapeEdit = { layerId: layer.id, mode, start: point, before: { ...shape } };
    return true;
  }

  updateShapeEdit(point: StrokePoint, _event?: PointerEvent): boolean {
    const edit = this.shapeEdit;
    if (!edit) return false;
    const layer = this.engine.layerService.shapeById(edit.layerId);
    if (!layer) return false;
    const dx = point.x - edit.start.x;
    const dy = point.y - edit.start.y;
    let next: ShapeParams = { ...edit.before };
    if (edit.mode === 'move') next = translateShape(edit.before, dx, dy);
    else if (edit.mode === 'rotate') {
      const center = shapeCenter(edit.before);
      const initial = Math.atan2(edit.start.y - center.y, edit.start.x - center.x);
      next = rotateShape(edit.before, Math.atan2(point.y - center.y, point.x - center.x) - initial);
    }
    else if (edit.before.kind === 'line') {
      next = edit.mode === 'start'
        ? { ...edit.before, x1: point.x, y1: point.y }
        : { ...edit.before, x2: point.x, y2: point.y };
    } else {
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
    this.engine.requestRender();
    this.engine.syncStore();
    return true;
  }

  finishShapeEdit(_point: StrokePoint): boolean {
    const edit = this.shapeEdit;
    if (!edit) return false;
    this.shapeEdit = null;
    const layer = this.engine.layerService.shapeById(edit.layerId);
    if (layer && JSON.stringify(layer.shape) !== JSON.stringify(edit.before)) {
      this.engine.history.push({ kind: 'layerProps', layerId: layer.id, before: { shape: edit.before }, after: { shape: { ...layer.shape } } }, '図形を編集');
      this.engine.committed();
    }
    return true;
  }

  cancelShapeEdit(): void {
    const edit = this.shapeEdit;
    if (!edit) return;
    const layer = this.engine.layerService.shapeById(edit.layerId);
    if (layer) layer.shape = edit.before;
    this.shapeEdit = null;
    this.engine.requestRender();
    this.engine.syncStore();
  }

  drawActiveShapeHandles(ctx: CanvasRenderingContext2D): void {
    const layer = this.engine.layerService.shapeById(this.engine.layerService.activeLayerId);
    if (!layer) return;
    const shape = layer.shape;
    const b = shapeBounds(shape);
    const points = shape.kind === 'line'
      ? [[shape.x1, shape.y1], [shape.x2, shape.y2]]
      : shapeCorners(shape).map(point => [point.x, point.y]);
    const scale = this.engine.uiScale();
    const center = shapeCenter(shape);
    const rotateHandle = { x: center.x, y: b.y - 28 * scale };
    ctx.save();
    ctx.strokeStyle = '#4f8cff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 1.5 * scale;
    ctx.setLineDash([4 * scale, 3 * scale]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    for (const [x, y] of points) {
      ctx.beginPath();
      ctx.rect(x - 4 * scale, y - 4 * scale, 8 * scale, 8 * scale);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(center.x, b.y); ctx.lineTo(rotateHandle.x, rotateHandle.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(rotateHandle.x, rotateHandle.y, 5 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
