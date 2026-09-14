import { useStore } from '../../state/store';
import { DEFAULT_TRANSFORM, type TransformState } from '../../model/transform';
import type { PaintEngine } from '../PaintEngine';
import type { LayerOf } from '../layers';
import {
  inverseMatrix,
  mapPoint,
  matrixToTransform,
  quadMatrix,
  rectCorners,
  transformMatrix,
  type Point,
} from './projective';

export type TransformEditMode = 'scale' | 'shear' | 'perspective';
interface Drag {
  layerId: string;
  before: TransformState;
  start: Point;
  source: Point[];
  target: Point[];
  handle: number | 'move' | 'rotate';
  mode: TransformEditMode;
}
const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
const centerOf = (points: Point[]): Point => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / 4,
  y: points.reduce((sum, p) => sum + p.y, 0) / 4,
});

/** Direct editing of a layer effect. One pointer drag produces one history entry. */
export class TransformEditController {
  mode: TransformEditMode = 'perspective';
  private drag: Drag | null = null;
  constructor(private engine: PaintEngine) {}

  activeLayer(): LayerOf<'transform'> | null {
    if (useStore.getState().multiSelectMode) return null;
    const layer = this.engine.layerById(this.engine.getActiveLayerId());
    return layer?.type === 'transform' && layer.visible ? layer : null;
  }
  hasEdit(): boolean {
    return this.drag !== null;
  }
  setMode(mode: TransformEditMode): void {
    this.cancel();
    this.mode = mode;
    this.engine.requestOverlayRender();
  }
  frame() {
    const layer = this.activeLayer();
    if (!layer) return null;
    // The effect transforms its composited input, just like an adjustment layer.
    // The page is the editing frame even when the input is currently transparent.
    const { w, h } = this.engine.artboard;
    const source = rectCorners({ x: 0, y: 0, w, h });
    const matrix = transformMatrix(layer.state, w, h);
    const target = source.map((p) => mapPoint(matrix, p.x, p.y));
    return target.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      ? { source, target }
      : null;
  }
  private rotateHandle(points: Point[]): Point {
    const top = midpoint(points[0], points[1]),
      center = centerOf(points);
    const distance = Math.max(
      1,
      Math.hypot(top.x - center.x, top.y - center.y),
    );
    const gap = 32 * this.engine.uiScale();
    return {
      x: top.x + ((top.x - center.x) / distance) * gap,
      y: top.y + ((top.y - center.y) / distance) * gap,
    };
  }
  begin(point: Point): boolean {
    const layer = this.activeLayer(),
      frame = this.frame();
    if (!layer || !frame || this.engine.isBusy()) return false;
    const radius = 11 * this.engine.uiScale();
    const near = (p: Point) =>
      Math.hypot(point.x - p.x, point.y - p.y) <= radius;
    let handle: Drag['handle'] | null = near(this.rotateHandle(frame.target))
      ? 'rotate'
      : null;
    if (handle === null && this.mode !== 'shear') {
      const corner = frame.target.findIndex(near);
      if (corner >= 0) handle = corner;
    }
    if (handle === null) {
      const edge = frame.target.findIndex((p, i) =>
        near(midpoint(p, frame.target[(i + 1) % 4])),
      );
      if (edge >= 0) handle = edge + 4;
    }
    if (handle === null) {
      const signs = frame.target.map((a, i) => {
        const b = frame.target[(i + 1) % 4];
        return Math.sign(
          (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x),
        );
      });
      if (signs.every((sign) => sign >= 0) || signs.every((sign) => sign <= 0))
        handle = 'move';
    }
    if (handle === null) return false;
    this.engine.compositor.beginTransformPreview(layer.id);
    this.drag = {
      layerId: layer.id,
      before: { ...layer.state },
      start: { ...point },
      ...frame,
      handle,
      mode: this.mode,
    };
    this.engine.requestOverlayRender();
    return true;
  }
  update(point: Point): boolean {
    const drag = this.drag;
    if (!drag) return false;
    if (this.engine.getActiveLayerId() !== drag.layerId) {
      this.cancel();
      return false;
    }
    const dx = point.x - drag.start.x,
      dy = point.y - drag.start.y;
    let target = drag.target.map((p) => ({ ...p }));
    if (drag.handle === 'move') {
      target = target.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    } else if (drag.handle === 'rotate') {
      const center = centerOf(target);
      const angle =
        Math.atan2(point.y - center.y, point.x - center.x) -
        Math.atan2(drag.start.y - center.y, drag.start.x - center.x);
      target = target.map((p) => ({
        x:
          center.x +
          (p.x - center.x) * Math.cos(angle) -
          (p.y - center.y) * Math.sin(angle),
        y:
          center.y +
          (p.x - center.x) * Math.sin(angle) +
          (p.y - center.y) * Math.cos(angle),
      }));
    } else if (drag.mode === 'perspective') {
      const indices =
        drag.handle < 4
          ? [drag.handle]
          : [drag.handle - 4, (drag.handle - 3) % 4];
      for (const index of indices)
        target[index] = { x: target[index].x + dx, y: target[index].y + dy };
    } else if (drag.mode === 'shear') {
      const edge = drag.handle - 4,
        next = (edge + 1) % 4;
      const a = target[edge],
        b = target[next],
        length = Math.hypot(b.x - a.x, b.y - a.y);
      const ux = (b.x - a.x) / length,
        uy = (b.y - a.y) / length,
        distance = dx * ux + dy * uy;
      target[edge] = { x: a.x + ux * distance, y: a.y + uy * distance };
      target[next] = { x: b.x + ux * distance, y: b.y + uy * distance };
    } else {
      const { w, h } = this.engine.artboard;
      const matrix = transformMatrix(drag.before, w, h),
        inverse = inverseMatrix(matrix);
      if (!inverse) return true;
      const corner = drag.handle < 4;
      const index = corner ? drag.handle : drag.handle - 4;
      const anchor = corner
        ? drag.source[(index + 2) % 4]
        : midpoint(drag.source[(index + 2) % 4], drag.source[(index + 3) % 4]);
      const grabbed = corner
        ? drag.source[index]
        : midpoint(drag.source[index], drag.source[(index + 1) % 4]);
      const actual = corner
        ? drag.target[index]
        : midpoint(drag.target[index], drag.target[(index + 1) % 4]);
      const moved = mapPoint(inverse, actual.x + dx, actual.y + dy);
      const sx =
        grabbed.x === anchor.x
          ? 1
          : (moved.x - anchor.x) / (grabbed.x - anchor.x);
      const sy =
        grabbed.y === anchor.y
          ? 1
          : (moved.y - anchor.y) / (grabbed.y - anchor.y);
      if (Math.abs(sx) < 0.001 || Math.abs(sy) < 0.001) return true;
      target = drag.source.map((p) =>
        mapPoint(
          matrix,
          anchor.x + (p.x - anchor.x) * sx,
          anchor.y + (p.y - anchor.y) * sy,
        ),
      );
    }
    const matrix = quadMatrix(drag.source, target);
    const state =
      matrix &&
      matrixToTransform(matrix, this.engine.artboard.w, this.engine.artboard.h);
    if (state) this.engine.previewLayerProps(drag.layerId, { state });
    return true;
  }
  finish(point: Point): boolean {
    if (!this.drag) return false;
    this.update(point);
    const drag = this.drag;
    this.drag = null;
    this.engine.compositor.endTransformPreview();
    if (!drag) return true;
    const layer = this.engine.layerById(drag.layerId);
    if (
      layer?.type === 'transform' &&
      Object.keys(drag.before).some(
        (key) =>
          Math.abs(
            layer.state[key as keyof TransformState] -
              drag.before[key as keyof TransformState],
          ) > 1e-8,
      )
    ) {
      this.engine.commitLayerProps(
        layer.id,
        { state: drag.before },
        { state: { ...layer.state } },
        'トランスフォームを操作',
      );
    }
    this.engine.requestRender();
    return true;
  }
  cancel(): void {
    const drag = this.drag;
    this.drag = null;
    this.engine.compositor.endTransformPreview();
    if (drag)
      this.engine.previewLayerProps(drag.layerId, { state: drag.before });
  }
  reset(): void {
    this.cancel();
    const layer = this.activeLayer();
    if (layer)
      this.engine.commitLayerProps(
        layer.id,
        { state: { ...layer.state } },
        { state: { ...DEFAULT_TRANSFORM } },
        '自由変形をリセット',
      );
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const frame = this.frame();
    if (!frame) return;
    const points = frame.target,
      scale = this.engine.uiScale(),
      rotate = this.rotateHandle(points),
      top = midpoint(points[0], points[1]);
    ctx.save();
    ctx.strokeStyle = '#2563eb';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(rotate.x, rotate.y);
    ctx.stroke();
    if (this.mode !== 'shear')
      for (const p of points) {
        ctx.fillRect(p.x - 5 * scale, p.y - 5 * scale, 10 * scale, 10 * scale);
        ctx.strokeRect(
          p.x - 5 * scale,
          p.y - 5 * scale,
          10 * scale,
          10 * scale,
        );
      }
    for (let i = 0; i < 4; i++) {
      const p = midpoint(points[i], points[(i + 1) % 4]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 5 * scale);
      ctx.lineTo(p.x + 5 * scale, p.y);
      ctx.lineTo(p.x, p.y + 5 * scale);
      ctx.lineTo(p.x - 5 * scale, p.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(rotate.x, rotate.y, 6 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
