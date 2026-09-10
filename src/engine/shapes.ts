import { TRANSPARENT, type ShapeParams, type StrokePoint } from '../types';

export function shapeFromDrag(
  kind: ShapeParams['kind'],
  a: StrokePoint,
  b: StrokePoint,
  color: string,
  width: number,
): ShapeParams | null {
  if (kind === 'line') {
    if (a.x === b.x && a.y === b.y) return null;
    return { kind, x1: a.x, y1: a.y, x2: b.x, y2: b.y, color, width };
  }
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  if (w === 0 || h === 0) return null;
  if (kind === 'rect') {
    return { kind, x, y, width: w, height: h, color, strokeWidth: width };
  }
  return {
    kind,
    cx: x + w / 2,
    cy: y + h / 2,
    rx: w / 2,
    ry: h / 2,
    color,
    strokeWidth: width,
  };
}

export function shapeStrokeWidth(shape: ShapeParams): number {
  return shape.kind === 'line' ? shape.width : shape.strokeWidth;
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: ShapeParams,
  erase = shape.color === TRANSPARENT,
): void {
  ctx.save();
  if (erase) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = '#000';
  } else {
    ctx.strokeStyle = shape.color;
  }
  ctx.lineWidth = shapeStrokeWidth(shape);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (shape.kind === 'line') {
    ctx.moveTo(shape.x1, shape.y1);
    ctx.lineTo(shape.x2, shape.y2);
  } else if (shape.kind === 'rect') {
    ctx.rect(shape.x, shape.y, shape.width, shape.height);
  } else {
    ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

export function shapeBounds(shape: ShapeParams): { x: number; y: number; w: number; h: number } {
  if (shape.kind === 'line') {
    return {
      x: Math.min(shape.x1, shape.x2),
      y: Math.min(shape.y1, shape.y2),
      w: Math.abs(shape.x2 - shape.x1),
      h: Math.abs(shape.y2 - shape.y1),
    };
  }
  if (shape.kind === 'rect') return { x: shape.x, y: shape.y, w: shape.width, h: shape.height };
  return { x: shape.cx - shape.rx, y: shape.cy - shape.ry, w: shape.rx * 2, h: shape.ry * 2 };
}

export function translateShape(shape: ShapeParams, dx: number, dy: number): ShapeParams {
  if (shape.kind === 'line') {
    return { ...shape, x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy };
  }
  if (shape.kind === 'rect') return { ...shape, x: shape.x + dx, y: shape.y + dy };
  return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
}
