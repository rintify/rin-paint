import {
  TRANSPARENT,
  normalizeShapePaintMode,
  type PolygonShapeParams,
  type ShapePaintMode,
  type ShapeParams,
  type ShapePoint,
  type StrokePoint,
} from '../types';

export type DragShapeKind = 'line' | 'rect' | 'ellipse';

export function cloneShape<T extends ShapeParams>(shape: T): T {
  return structuredClone(shape);
}

export function shapeFromDrag(
  kind: DragShapeKind,
  a: StrokePoint,
  b: StrokePoint,
  color: string,
  width: number,
  paintMode: ShapePaintMode = 'stroke',
): ShapeParams | null {
  if (kind === 'line') {
    if (a.x === b.x && a.y === b.y) return null;
    return { kind, x1: a.x, y1: a.y, x2: b.x, y2: b.y, color, strokeWidth: width };
  }
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  if (w === 0 || h === 0) return null;
  if (kind === 'rect') {
    return { kind, x, y, width: w, height: h, color, strokeWidth: width, rotation: 0, paintMode };
  }
  return { kind, cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, color, strokeWidth: width, rotation: 0, paintMode };
}

export function shapeStrokeWidth(shape: ShapeParams): number {
  return shape.strokeWidth;
}

export function shapePaintMode(shape: ShapeParams): ShapePaintMode {
  return shape.kind === 'line' ? 'stroke' : normalizeShapePaintMode(shape.paintMode);
}

function appendClosedPath(ctx: CanvasRenderingContext2D, shape: Exclude<ShapeParams, { kind: 'line' }>): void {
  if (shape.kind === 'ellipse') {
    ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, shape.rotation ?? 0, 0, Math.PI * 2);
    return;
  }
  const points = shape.kind === 'rect' ? shapeCorners(shape) : shapeWorldPoints(shape);
  if (!points.length) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
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
  ctx.beginPath();
  if (shape.kind === 'line') {
    ctx.moveTo(shape.x1, shape.y1);
    ctx.lineTo(shape.x2, shape.y2);
    ctx.stroke();
  } else {
    const mode = shapePaintMode(shape);
    if (mode === 'fill-outside') ctx.rect(0, 0, artboard.w, artboard.h);
    appendClosedPath(ctx, shape);
    if (mode === 'stroke') ctx.stroke();
    else ctx.fill(mode === 'fill-outside' ? 'evenodd' : 'nonzero');
  }
  ctx.restore();
}

export function shapeBounds(shape: ShapeParams): { x: number; y: number; w: number; h: number } {
  if (shape.kind === 'line') {
    return { x: Math.min(shape.x1, shape.x2), y: Math.min(shape.y1, shape.y2), w: Math.abs(shape.x2 - shape.x1), h: Math.abs(shape.y2 - shape.y1) };
  }
  if (shape.kind === 'rect') return pointsBounds(shapeCorners(shape));
  if (shape.kind === 'polygon') return pointsBounds(shapeWorldPoints(shape));
  const a = shape.rotation ?? 0;
  const rx = Math.sqrt(shape.rx ** 2 * Math.cos(a) ** 2 + shape.ry ** 2 * Math.sin(a) ** 2);
  const ry = Math.sqrt(shape.rx ** 2 * Math.sin(a) ** 2 + shape.ry ** 2 * Math.cos(a) ** 2);
  return { x: shape.cx - rx, y: shape.cy - ry, w: rx * 2, h: ry * 2 };
}

function pointsBounds(points: ShapePoint[]): { x: number; y: number; w: number; h: number } {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export function shapeCenter(shape: ShapeParams): ShapePoint {
  if (shape.kind === 'line') return { x: (shape.x1 + shape.x2) / 2, y: (shape.y1 + shape.y2) / 2 };
  if (shape.kind === 'rect') return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  return { x: shape.cx, y: shape.cy };
}

export function shapeCorners(shape: Extract<ShapeParams, { kind: 'rect' | 'ellipse' }>): ShapePoint[] {
  const center = shapeCenter(shape);
  const hw = shape.kind === 'rect' ? shape.width / 2 : shape.rx;
  const hh = shape.kind === 'rect' ? shape.height / 2 : shape.ry;
  const angle = shape.rotation ?? 0;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos }));
}

export function shapeWorldPoints(shape: PolygonShapeParams): ShapePoint[] {
  const angle = shape.rotation ?? 0;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return shape.points.map((point) => ({ x: shape.cx + point.x * cos - point.y * sin, y: shape.cy + point.x * sin + point.y * cos }));
}

export function polygonFromWorldPoints(points: ShapePoint[], style: Pick<PolygonShapeParams, 'color' | 'strokeWidth' | 'paintMode'>): PolygonShapeParams {
  const bounds = pointsBounds(points);
  const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;
  return { kind: 'polygon', cx, cy, points: points.map((point) => ({ x: point.x - cx, y: point.y - cy })), rotation: 0, color: style.color, strokeWidth: style.strokeWidth, paintMode: normalizeShapePaintMode(style.paintMode) };
}

export function rotateShape(shape: ShapeParams, angle: number, pivot = shapeCenter(shape)): ShapeParams {
  const turn = (x: number, y: number) => { const dx = x - pivot.x, dy = y - pivot.y, cos = Math.cos(angle), sin = Math.sin(angle); return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos }; };
  if (shape.kind === 'line') { const a = turn(shape.x1, shape.y1), b = turn(shape.x2, shape.y2); return { ...shape, x1: a.x, y1: a.y, x2: b.x, y2: b.y }; }
  const center = turn(shapeCenter(shape).x, shapeCenter(shape).y);
  if (shape.kind === 'rect') return { ...shape, x: center.x - shape.width / 2, y: center.y - shape.height / 2, rotation: (shape.rotation ?? 0) + angle };
  return { ...shape, cx: center.x, cy: center.y, rotation: (shape.rotation ?? 0) + angle };
}

export function translateShape(shape: ShapeParams, dx: number, dy: number): ShapeParams {
  if (shape.kind === 'line') return { ...shape, x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy };
  if (shape.kind === 'rect') return { ...shape, x: shape.x + dx, y: shape.y + dy };
  return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
}

function orientation(a: ShapePoint, b: ShapePoint, c: ShapePoint): number { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function onSegment(a: ShapePoint, b: ShapePoint, p: ShapePoint): boolean {
  const e = 1e-7;
  return Math.abs(orientation(a, b, p)) <= e && p.x >= Math.min(a.x, b.x) - e && p.x <= Math.max(a.x, b.x) + e && p.y >= Math.min(a.y, b.y) - e && p.y <= Math.max(a.y, b.y) + e;
}

export function segmentsIntersect(a: ShapePoint, b: ShapePoint, c: ShapePoint, d: ShapePoint): boolean {
  const abC = orientation(a, b, c), abD = orientation(a, b, d), cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return (Math.abs(abC) <= 1e-7 && onSegment(a, b, c)) || (Math.abs(abD) <= 1e-7 && onSegment(a, b, d)) || (Math.abs(cdA) <= 1e-7 && onSegment(c, d, a)) || (Math.abs(cdB) <= 1e-7 && onSegment(c, d, b));
}

export function polygonSelfIntersects(points: ShapePoint[]): boolean {
  const count = points.length;
  if (count < 3) return true;
  for (let i = 0; i < count; i++) {
    const a = points[i], b = points[(i + 1) % count];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) return true;
    for (let j = i + 1; j < count; j++) {
      if (j === i || j === (i + 1) % count || (j + 1) % count === i) continue;
      if (segmentsIntersect(a, b, points[j], points[(j + 1) % count])) return true;
    }
  }
  return false;
}

export function pointInPolygon(point: ShapePoint, polygon: ShapePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (onSegment(a, b, point)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonArea(points: ShapePoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; sum += a.x * b.y - b.x * a.y; }
  return sum / 2;
}
