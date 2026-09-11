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
    return { kind, x, y, width: w, height: h, color, strokeWidth: width, rotation: 0 };
  }
  return {
    kind,
    cx: x + w / 2,
    cy: y + h / 2,
    rx: w / 2,
    ry: h / 2,
    color,
    strokeWidth: width,
    rotation: 0,
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
    const cx = shape.x + shape.width / 2;
    const cy = shape.y + shape.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(shape.rotation ?? 0);
    ctx.rect(-shape.width / 2, -shape.height / 2, shape.width, shape.height);
  } else {
    ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, shape.rotation ?? 0, 0, Math.PI * 2);
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
  if (shape.kind === 'rect') {
    const cs = shapeCorners(shape);
    const xs = cs.map((p) => p.x), ys = cs.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  const a = shape.rotation ?? 0;
  const rx = Math.sqrt(shape.rx ** 2 * Math.cos(a) ** 2 + shape.ry ** 2 * Math.sin(a) ** 2);
  const ry = Math.sqrt(shape.rx ** 2 * Math.sin(a) ** 2 + shape.ry ** 2 * Math.cos(a) ** 2);
  return { x: shape.cx - rx, y: shape.cy - ry, w: rx * 2, h: ry * 2 };
}

export interface ShapePoint { x: number; y: number }

export function shapeCenter(shape: ShapeParams): ShapePoint {
  if (shape.kind === 'line') return { x: (shape.x1 + shape.x2) / 2, y: (shape.y1 + shape.y2) / 2 };
  if (shape.kind === 'rect') return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  return { x: shape.cx, y: shape.cy };
}

export function shapeCorners(shape: Exclude<ShapeParams, { kind: 'line' }>): ShapePoint[] {
  const center = shapeCenter(shape);
  const hw = shape.kind === 'rect' ? shape.width / 2 : shape.rx;
  const hh = shape.kind === 'rect' ? shape.height / 2 : shape.ry;
  const angle = shape.rotation ?? 0;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({
    x: center.x + x * cos - y * sin,
    y: center.y + x * sin + y * cos,
  }));
}

export function rotateShape(shape: ShapeParams, angle: number, pivot = shapeCenter(shape)): ShapeParams {
  const turn = (x: number, y: number) => {
    const dx = x - pivot.x, dy = y - pivot.y, cos = Math.cos(angle), sin = Math.sin(angle);
    return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
  };
  if (shape.kind === 'line') {
    const a = turn(shape.x1, shape.y1), b = turn(shape.x2, shape.y2);
    return { ...shape, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }
  const originalCenter = shapeCenter(shape);
  const center = turn(originalCenter.x, originalCenter.y);
  return shape.kind === 'rect'
    ? { ...shape, x: center.x - shape.width / 2, y: center.y - shape.height / 2, rotation: (shape.rotation ?? 0) + angle }
    : { ...shape, cx: center.x, cy: center.y, rotation: (shape.rotation ?? 0) + angle };
}

export function translateShape(shape: ShapeParams, dx: number, dy: number): ShapeParams {
  if (shape.kind === 'line') {
    return { ...shape, x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy };
  }
  if (shape.kind === 'rect') return { ...shape, x: shape.x + dx, y: shape.y + dy };
  return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
}
