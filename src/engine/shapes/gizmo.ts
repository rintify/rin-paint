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
  /** しっぽ作成中は、クリック対象である先端だけを操作可能な見た目にする。 */
  tailPlacement?: boolean;
}

const TAIL_HANDLE_LABELS = ['根元', '曲がり', '先端'] as const;

/** しっぽの3点は役割が異なるため、通常図形とは違う専用ギズモで示す。 */
function drawBubbleTailGizmo(
  ctx: CanvasRenderingContext2D,
  shape: Extract<ShapeParams, { kind: 'bubble-tail' }>,
  style: ShapeGizmoStyle,
): void {
  const scale = style.scale;
  const color = style.invalid ? '#e53935' : '#2877e8';
  const points = [shape.start, shape.control, shape.tip];
  const placementGuide = !!style.tailPlacement;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * scale;

  // 薄い補助線で、曲がり点がベジェ曲線を制御していることを見せる。
  ctx.globalAlpha = .55;
  ctx.setLineDash([3 * scale, 3 * scale]);
  ctx.beginPath();
  ctx.moveTo(shape.start.x, shape.start.y);
  ctx.lineTo(shape.control.x, shape.control.y);
  ctx.lineTo(shape.tip.x, shape.tip.y);
  ctx.stroke();

  // 実際の中心線は太めの曲線にして、完成形との対応を分かりやすくする。
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.moveTo(shape.start.x, shape.start.y);
  ctx.quadraticCurveTo(
    shape.control.x,
    shape.control.y,
    shape.tip.x,
    shape.tip.y,
  );
  ctx.stroke();

  if (style.handles === false) {
    ctx.restore();
    return;
  }

  points.forEach((point, index) => {
    const selected = style.selectedIndex === index;
    ctx.fillStyle = selected || (placementGuide && index < 2) ? color : '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    if (index === 0) {
      const radius = (placementGuide ? 3 : 4.5) * scale;
      ctx.rect(point.x - radius, point.y - radius, radius * 2, radius * 2);
    } else if (index === 1) {
      const radius = (placementGuide ? 3 : 5) * scale;
      ctx.moveTo(point.x, point.y - radius);
      ctx.lineTo(point.x + radius, point.y);
      ctx.lineTo(point.x, point.y + radius);
      ctx.lineTo(point.x - radius, point.y);
      ctx.closePath();
    } else {
      ctx.arc(point.x, point.y, 6 * scale, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();

    const label = placementGuide
      ? index === 2 ? '先端を配置' : null
      : TAIL_HANDLE_LABELS[index];
    if (!label) return;
    ctx.font = `${Math.max(10, 11 * scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const labelY = point.y - 9 * scale;
    const labelWidth = ctx.measureText(label).width + 8 * scale;
    ctx.fillStyle = 'rgba(255, 255, 255, .92)';
    ctx.fillRect(
      point.x - labelWidth / 2,
      labelY - 14 * scale,
      labelWidth,
      14 * scale,
    );
    ctx.fillStyle = color;
    ctx.fillText(label, point.x, labelY - 1 * scale);
  });
  ctx.restore();
}

/** 図形の外接矩形・頂点・回転ハンドル。作成中プレビューでも編集中でも同じ見た目。 */
export function drawShapeGizmo(
  ctx: CanvasRenderingContext2D,
  shape: ShapeParams,
  style: ShapeGizmoStyle,
): void {
  if (shape.kind === 'bubble-tail') {
    drawBubbleTailGizmo(ctx, shape, style);
    return;
  }
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
