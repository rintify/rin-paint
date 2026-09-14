import type { ShapeParams, ShapePoint } from '../../model';
import { shapeKindHandler } from './kinds/registry';

function shapeBounds(shape: ShapeParams) {
  return shapeKindHandler(shape).bounds(shape);
}
function shapeCenter(shape: ShapeParams) {
  return shapeKindHandler(shape).center(shape);
}
function shapePoints(shape: ShapeParams) {
  return shapeKindHandler(shape).points(shape);
}

/** 回転ハンドルは外接矩形の上辺からこれだけ離す (画面 px) */
export const ROTATE_HANDLE_GAP = 28;

export function shapeRotateHandle(
  shape: ShapeParams,
  scale: number,
): ShapePoint {
  return {
    x: shapeCenter(shape).x,
    y: shapeBounds(shape).y - ROTATE_HANDLE_GAP * scale,
  };
}

export interface ShapeGizmoStyle {
  scale: number;
  invalid?: boolean;
  selectedIndex?: number;
  insertions?: boolean;
  /** false なら外接矩形などの点線だけ。未指定はハンドルあり。 */
  handles?: boolean;
}

/** 図形の外接矩形・頂点・回転ハンドル。作成中プレビューでも編集中でも同じ見た目。 */
export function drawShapeGizmo(
  ctx: CanvasRenderingContext2D,
  shape: ShapeParams,
  style: ShapeGizmoStyle,
): void {
  const bounds = shapeBounds(shape);
  const scale = style.scale;
  const center = shapeCenter(shape);
  const invalid = !!style.invalid;
  const handles = style.handles !== false;
  const points = shapePoints(shape);
  const insertions =
    handles && style.insertions
      ? shapeKindHandler(shape).edit.insertionPoints(shape)
      : [];
  const rotateHandle = shapeRotateHandle(shape, scale);
  ctx.save();
  ctx.strokeStyle = invalid ? '#e53935' : '#4f8cff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = 1.5 * scale;
  if (shape.kind === 'bubble-tail') {
    ctx.setLineDash([4 * scale, 3 * scale]);
    ctx.beginPath();
    ctx.moveTo(shape.start.x, shape.start.y);
    ctx.lineTo(shape.control.x, shape.control.y);
    ctx.lineTo(shape.tip.x, shape.tip.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (invalid && points.length) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++)
      ctx.lineTo(points[index].x, points[index].y);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.setLineDash([4 * scale, 3 * scale]);
  ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
  ctx.setLineDash([]);
  if (!handles) {
    ctx.restore();
    return;
  }
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    ctx.fillStyle = style.selectedIndex === index ? '#4f8cff' : '#fff';
    ctx.beginPath();
    ctx.rect(point.x - 4 * scale, point.y - 4 * scale, 8 * scale, 8 * scale);
    ctx.fill();
    ctx.stroke();
    const insertion = insertions[index];
    if (!insertion) continue;
    const { x, y } = insertion;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 4 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 2 * scale, y);
    ctx.lineTo(x + 2 * scale, y);
    ctx.moveTo(x, y - 2 * scale);
    ctx.lineTo(x, y + 2 * scale);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(center.x, bounds.y);
  ctx.lineTo(rotateHandle.x, rotateHandle.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rotateHandle.x, rotateHandle.y, 5 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const arm = 8 * scale;
  const drawCenter = () => {
    ctx.beginPath();
    ctx.moveTo(center.x - arm, center.y);
    ctx.lineTo(center.x + arm, center.y);
    ctx.moveTo(center.x, center.y - arm);
    ctx.lineTo(center.x, center.y + arm);
    ctx.stroke();
  };
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3 * scale;
  drawCenter();
  ctx.strokeStyle = invalid ? '#e53935' : '#4f8cff';
  ctx.lineWidth = 1.5 * scale;
  drawCenter();
  ctx.restore();
}
