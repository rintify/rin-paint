import {
  TRANSPARENT,
  normalizeShapePaintMode,
  type PolygonShapeParams,
  type ShapePaintMode,
  type ShapeParams,
  type ShapePoint,
  type StrokePoint,
} from '../../model';
import { pointsBounds, type ShapeBounds } from './geometry';
import { shapeKindHandler, shapeKindHandlerOf } from './kinds/registry';
import type {
  ShapeControlField,
  ShapeParameterField,
  ShapePanelAction,
  ShapeTransform,
} from './kinds/types';

export {
  cloneShape,
  pointInPolygon,
  polygonArea,
  polygonSelfIntersects,
  segmentsIntersect,
} from './geometry';
export type { ShapeBounds } from './geometry';
export { shapeKindHandler } from './kinds/registry';
export type {
  ShapeControlField,
  ShapeDrag,
  ShapeDragResult,
  ShapeEditMode,
  ShapeHit,
  ShapeHitTest,
  ShapeKindHandler,
  ShapePanelAction,
  ShapeParameterField,
  ShapeTransform,
  ShapeVertexDelete,
} from './kinds/types';

/** 2 点ドラッグだけで描ける種類 */
export type DragShapeKind = 'line' | 'rect' | 'ellipse';

export function shapeFromDrag(
  kind: DragShapeKind,
  a: StrokePoint,
  b: StrokePoint,
  color: string,
  width: number,
  paintMode: ShapePaintMode = 'stroke',
): ShapeParams | null {
  return shapeKindHandlerOf(kind).fromDrag?.(a, b, { color, strokeWidth: width, paintMode }) ?? null;
}

export function shapeStrokeWidth(shape: ShapeParams): number {
  return shape.strokeWidth;
}

export function shapePaintMode(shape: ShapeParams): ShapePaintMode {
  return shapeKindHandler(shape).paintMode(shape);
}

export function setShapePaintMode(shape: ShapeParams, mode: ShapePaintMode): ShapeParams {
  return shapeKindHandler(shape).setPaintMode(shape, mode);
}

/** 塗り方を選べる種類か (直線は輪郭のみ) */
export function shapeFillable(shape: ShapeParams): boolean {
  return shapeKindHandler(shape).fillable;
}

/** 種類に応じた既定のレイヤー名 */
export function shapeKindLabel(shape: ShapeParams): string {
  return shapeKindHandler(shape).label;
}

/** 省略されたフィールドを既定値で埋める */
export function normalizeShape(shape: ShapeParams): ShapeParams {
  return shapeKindHandler(shape).normalize(shape);
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: ShapeParams,
  erase = shape.color === TRANSPARENT,
  artboard = { w: ctx.canvas.width, h: ctx.canvas.height },
): void {
  ctx.save();
  if (erase) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#000';
  } else {
    ctx.strokeStyle = shape.color;
    ctx.fillStyle = shape.color;
  }
  ctx.lineWidth = shapeStrokeWidth(shape);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  shapeKindHandler(shape).draw(ctx, shape, artboard);
  ctx.restore();
}

export function shapeBounds(shape: ShapeParams): ShapeBounds {
  return shapeKindHandler(shape).bounds(shape);
}

export function shapeCenter(shape: ShapeParams): ShapePoint {
  return shapeKindHandler(shape).center(shape);
}

/** ハンドル・当たり判定に使う代表点 */
export function shapePoints(shape: ShapeParams): ShapePoint[] {
  return shapeKindHandler(shape).points(shape);
}

export function shapeCorners(shape: Extract<ShapeParams, { kind: 'rect' | 'ellipse' }>): ShapePoint[] {
  return shapePoints(shape);
}

export function shapeWorldPoints(shape: PolygonShapeParams): ShapePoint[] {
  return shapePoints(shape);
}

/** 現在の回転角 (ラジアン)。直線は両端から求まる */
export function shapeRotation(shape: ShapeParams): number {
  return shapeKindHandler(shape).rotation(shape);
}

export function setShapeRotation(shape: ShapeParams, angle: number): ShapeParams {
  return shapeKindHandler(shape).setRotation(shape, angle);
}

export function rotateShape(shape: ShapeParams, angle: number, pivot = shapeCenter(shape)): ShapeParams {
  return shapeKindHandler(shape).rotate(shape, angle, pivot);
}

export function translateShape(shape: ShapeParams, dx: number, dy: number): ShapeParams {
  return shapeKindHandler(shape).translate(shape, dx, dy);
}

/** 解像度変更に伴う実寸スケール */
export function scaleShapeBy(shape: ShapeParams, factor: number): ShapeParams {
  return shapeKindHandler(shape).scale(shape, factor);
}

/** 自由変形 */
export function transformShape(shape: ShapeParams, context: ShapeTransform): ShapeParams {
  return shapeKindHandler(shape).transform(shape, context);
}

export function shapeParameterFields(shape: ShapeParams): ShapeParameterField[] {
  return shapeKindHandler(shape).parameterFields(shape);
}

export function shapeControlFields(shape: ShapeParams): ShapeControlField[] {
  return shapeKindHandler(shape).controlFields(shape);
}

export function shapePanelNote(shape: ShapeParams): string | null {
  return shapeKindHandler(shape).panelNote(shape);
}

export function shapePanelActions(shape: ShapeParams): ShapePanelAction[] {
  return shapeKindHandler(shape).panelActions(shape);
}

export function polygonFromWorldPoints(points: ShapePoint[], style: Pick<PolygonShapeParams, 'color' | 'strokeWidth' | 'paintMode'>): PolygonShapeParams {
  const bounds = pointsBounds(points);
  const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;
  return { kind: 'polygon', cx, cy, points: points.map((point) => ({ x: point.x - cx, y: point.y - cy })), rotation: 0, color: style.color, strokeWidth: style.strokeWidth, paintMode: normalizeShapePaintMode(style.paintMode) };
}
