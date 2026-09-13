import {
  TRANSPARENT,
  normalizeShapePaintMode,
  normalizeShapeStrokeJoin,
  type PolygonShapeParams,
  type ShapePaintMode,
  type ShapeParams,
  type ShapePoint,
  type StrokePoint,
} from '../../model';
import { polygonCentroid, type ShapeBounds } from './geometry';
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
  polygonCentroid,
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

/** Canvas 2D の標準値。描画と部分再描画領域の計算で共有する。 */
export const SHAPE_MITER_LIMIT = 10;

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
  pageFrame = { w: ctx.canvas.width, h: ctx.canvas.height },
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
  ctx.lineJoin = normalizeShapeStrokeJoin(shape.strokeJoin);
  ctx.miterLimit = SHAPE_MITER_LIMIT;
  shapeKindHandler(shape).draw(ctx, shape, pageFrame);
  ctx.restore();
}

export function shapeStrokeJoin(shape: ShapeParams) {
  return normalizeShapeStrokeJoin(shape.strokeJoin);
}

/** 線が代表点の外側へ描かれ得る最大量。部分再描画で残像を残さないための余白。 */
export function shapeVisualPadding(shape: ShapeParams): number {
  const stroke = Math.max(0, shape.strokeWidth);
  const half = stroke / 2;
  if (shapeStrokeJoin(shape) !== 'miter') return half + 2;
  const points = shapePoints(shape);
  if (points.length < 3) return half + 2;
  let extent = half;
  points.forEach((point, index) => {
    const prev = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const ax = prev.x - point.x, ay = prev.y - point.y;
    const bx = next.x - point.x, by = next.y - point.y;
    const a = Math.hypot(ax, ay), b = Math.hypot(bx, by);
    if (a < 1e-8 || b < 1e-8) return;
    const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (a * b)));
    const sinHalf = Math.sqrt(Math.max(0, (1 - cos) / 2));
    const miter = sinHalf > 1e-8 ? half / sinHalf : stroke * SHAPE_MITER_LIMIT;
    extent = Math.max(extent, Math.min(miter, stroke * SHAPE_MITER_LIMIT));
  });
  return extent + 2;
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

export function polygonFromWorldPoints(points: ShapePoint[], style: Pick<PolygonShapeParams, 'color' | 'strokeWidth' | 'paintMode' | 'strokeJoin' | 'cornerRadius'>): PolygonShapeParams {
  const { x: cx, y: cy } = polygonCentroid(points);
  return {
    kind: 'polygon', cx, cy,
    points: points.map((point) => ({ x: point.x - cx, y: point.y - cy })),
    rotation: 0, color: style.color, strokeWidth: style.strokeWidth,
    paintMode: normalizeShapePaintMode(style.paintMode),
    strokeJoin: normalizeShapeStrokeJoin(style.strokeJoin),
    cornerRadius: Math.max(0, style.cornerRadius ?? 0),
  };
}
