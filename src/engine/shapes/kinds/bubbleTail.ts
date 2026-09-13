import type { BubbleTailShapeParams, ShapePoint } from '../../../model';
import { pointInPolygon, pointsBounds, rotateAround } from '../geometry';
import { shapeFields } from './common';
import type { ShapeKindHandler } from './types';

const fields = shapeFields<BubbleTailShapeParams>('bubble-tail');
const SAMPLE_COUNT = 48;
const geometryCache = new WeakMap<BubbleTailShapeParams, TailGeometry>();

interface TailCircle extends ShapePoint { radius: number }
interface TailGeometry {
  centerline: ShapePoint[];
  pointed: ShapePoint[];
  circles: TailCircle[];
  bounds: { x: number; y: number; w: number; h: number };
}

function bezier(shape: BubbleTailShapeParams, t: number): ShapePoint {
  const u = 1 - t;
  return {
    x: u * u * shape.start.x + 2 * u * t * shape.control.x + t * t * shape.tip.x,
    y: u * u * shape.start.y + 2 * u * t * shape.control.y + t * t * shape.tip.y,
  };
}

function normal(a: ShapePoint, b: ShapePoint): ShapePoint {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = Math.max(1e-6, Math.hypot(dx, dy));
  return { x: -dy / length, y: dx / length };
}

function buildGeometry(shape: BubbleTailShapeParams): TailGeometry {
  const cached = geometryCache.get(shape);
  if (cached) return cached;
  const centerline = Array.from({ length: SAMPLE_COUNT + 1 }, (_, index) => bezier(shape, index / SAMPLE_COUNT));
  const lengths = [0];
  for (let index = 1; index < centerline.length; index++) {
    lengths.push(lengths[index - 1] + Math.hypot(
      centerline[index].x - centerline[index - 1].x,
      centerline[index].y - centerline[index - 1].y,
    ));
  }
  const total = lengths.at(-1) ?? 0;
  const atLength = (distance: number): ShapePoint => {
    const index = lengths.findIndex(value => value >= distance);
    if (index <= 0) return centerline[0];
    const before = lengths[index - 1], after = lengths[index];
    const ratio = after <= before ? 0 : (distance - before) / (after - before);
    return {
      x: centerline[index - 1].x + (centerline[index].x - centerline[index - 1].x) * ratio,
      y: centerline[index - 1].y + (centerline[index].y - centerline[index - 1].y) * ratio,
    };
  };
  const half = Math.max(.05, shape.width / 2);
  const left: ShapePoint[] = [], right: ShapePoint[] = [];
  centerline.forEach((point, index) => {
    const adjacent = index === centerline.length - 1 ? centerline[index - 1] : centerline[index + 1];
    const n = index === centerline.length - 1 ? normal(adjacent, point) : normal(point, adjacent);
    const radius = half * (1 - index / SAMPLE_COUNT);
    left.push({ x: point.x + n.x * radius, y: point.y + n.y * radius });
    right.push({ x: point.x - n.x * radius, y: point.y - n.y * radius });
  });
  const pointed = [...left, ...right.reverse()];
  const count = Math.max(2, Math.min(20, Math.round(shape.circleCount)));
  const radii = Array.from({ length: count }, (_, index) => {
    const t = index / (count - 1);
    return half * (1 - .7 * t);
  });
  const touchingDistances = radii.slice(0, -1).map((radius, index) => radius + radii[index + 1]);
  const touchingTotal = touchingDistances.reduce((sum, value) => sum + value, 0);
  const decay = Math.max(0, Math.min(1, Number(shape.spacingDecay) || 0));
  const weights = touchingDistances.map((_, index) => Math.exp(-2.2 * decay * index / Math.max(1, count - 2)));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const freeSpace = Math.max(0, total - touchingTotal);
  const segments = touchingDistances.map((distance, index) => total >= touchingTotal
    ? distance + freeSpace * weights[index] / weightTotal
    : distance * total / Math.max(.001, touchingTotal));
  let travelled = 0;
  const circles = radii.map((radius, index) => {
    if (index > 0) travelled += segments[index - 1];
    return { ...atLength(travelled), radius };
  });
  const rawBounds = shape.style === 'rounds'
    ? pointsBounds(circles.flatMap(circle => [
      { x: circle.x - circle.radius, y: circle.y - circle.radius },
      { x: circle.x + circle.radius, y: circle.y + circle.radius },
    ]))
    : pointsBounds(pointed);
  const geometry = { centerline, pointed, circles, bounds: rawBounds };
  geometryCache.set(shape, geometry);
  return geometry;
}

function rotateAll(shape: BubbleTailShapeParams, angle: number, pivot: ShapePoint): BubbleTailShapeParams {
  return {
    ...shape,
    start: rotateAround(shape.start.x, shape.start.y, pivot, angle),
    control: rotateAround(shape.control.x, shape.control.y, pivot, angle),
    tip: rotateAround(shape.tip.x, shape.tip.y, pivot, angle),
  };
}

export const bubbleTailShapeKind: ShapeKindHandler<BubbleTailShapeParams> = {
  kind: 'bubble-tail',
  label: 'しっぽ',
  fillable: false,

  normalize: shape => ({
    ...shape,
    style: shape.style === 'rounds' ? 'rounds' : 'pointed',
    width: Math.max(.1, Number(shape.width) || .1),
    circleCount: Math.max(2, Math.min(20, Math.round(Number(shape.circleCount) || 3))),
    spacingDecay: Math.max(0, Math.min(1, Number.isFinite(Number(shape.spacingDecay)) ? Number(shape.spacingDecay) : .35)),
    strokeWidth: 0,
    strokeJoin: 'round',
  }),

  draw(ctx, shape) {
    const geometry = buildGeometry(shape);
    ctx.beginPath();
    if (shape.style === 'rounds') {
      for (const circle of geometry.circles) {
        ctx.moveTo(circle.x + circle.radius, circle.y);
        ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
      }
    } else if (geometry.pointed.length) {
      ctx.moveTo(geometry.pointed[0].x, geometry.pointed[0].y);
      for (const point of geometry.pointed.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.closePath();
    }
    ctx.fill();
  },

  paintMode: () => 'fill-inside',
  setPaintMode: shape => shape,
  bounds: shape => buildGeometry(shape).bounds,
  center: shape => bezier(shape, .5),
  points: shape => [shape.start, shape.control, shape.tip],
  rotation: shape => Math.atan2(shape.tip.y - shape.start.y, shape.tip.x - shape.start.x),
  setRotation(shape, angle) {
    const center = bezier(shape, .5);
    const current = Math.atan2(shape.tip.y - shape.start.y, shape.tip.x - shape.start.x);
    return rotateAll(shape, angle - current, center);
  },
  rotate: rotateAll,
  translate: (shape, dx, dy) => ({
    ...shape,
    start: { x: shape.start.x + dx, y: shape.start.y + dy },
    control: { x: shape.control.x + dx, y: shape.control.y + dy },
    tip: { x: shape.tip.x + dx, y: shape.tip.y + dy },
  }),
  scale: (shape, factor) => ({
    ...shape,
    start: { x: shape.start.x * factor, y: shape.start.y * factor },
    control: { x: shape.control.x * factor, y: shape.control.y * factor },
    tip: { x: shape.tip.x * factor, y: shape.tip.y * factor },
    width: shape.width * factor,
  }),
  transform(shape, { transform, scale }) {
    return {
      ...shape,
      start: transform(shape.start.x, shape.start.y),
      control: transform(shape.control.x, shape.control.y),
      tip: transform(shape.tip.x, shape.tip.y),
      width: shape.width * scale,
    };
  },

  parameterFields: () => [
    fields.parameter('tail.startX', '根元 X', s => s.start.x, (s, v) => ({ ...s, start: { ...s.start, x: v } }), undefined, true),
    fields.parameter('tail.startY', '根元 Y', s => s.start.y, (s, v) => ({ ...s, start: { ...s.start, y: v } }), undefined, true),
    fields.parameter('tail.controlX', '中間点 X', s => s.control.x, (s, v) => ({ ...s, control: { ...s.control, x: v } }), undefined, true),
    fields.parameter('tail.controlY', '中間点 Y', s => s.control.y, (s, v) => ({ ...s, control: { ...s.control, y: v } }), undefined, true),
    fields.parameter('tail.tipX', '先端 X', s => s.tip.x, (s, v) => ({ ...s, tip: { ...s.tip, x: v } }), undefined, true),
    fields.parameter('tail.tipY', '先端 Y', s => s.tip.y, (s, v) => ({ ...s, tip: { ...s.tip, y: v } }), undefined, true),
    fields.parameter('tail.width', 'しっぽの太さ', s => s.width, (s, v) => ({ ...s, width: Math.max(.1, v) }), .1, true),
    fields.parameter('tail.circleCount', '丸の数', s => s.circleCount, (s, v) => ({ ...s, circleCount: Math.max(2, Math.min(20, Math.round(v))) }), 2),
    fields.parameter('tail.spacingDecay', '間隔減衰', s => s.spacingDecay * 100, (s, v) => ({ ...s, spacingDecay: Math.max(0, Math.min(1, v / 100)) }), 0),
  ],
  controlFields: shape => [
    fields.control('根元 X', shape.start.x, (s, v) => ({ ...s, start: { ...s.start, x: v } }), undefined, true),
    fields.control('根元 Y', shape.start.y, (s, v) => ({ ...s, start: { ...s.start, y: v } }), undefined, true),
    fields.control('中間点 X', shape.control.x, (s, v) => ({ ...s, control: { ...s.control, x: v } }), undefined, true),
    fields.control('中間点 Y', shape.control.y, (s, v) => ({ ...s, control: { ...s.control, y: v } }), undefined, true),
    fields.control('先端 X', shape.tip.x, (s, v) => ({ ...s, tip: { ...s.tip, x: v } }), undefined, true),
    fields.control('先端 Y', shape.tip.y, (s, v) => ({ ...s, tip: { ...s.tip, y: v } }), undefined, true),
    fields.control('しっぽの太さ', shape.width, (s, v) => ({ ...s, width: Math.max(.1, v) }), .1, true),
  ],
  panelNote: shape => shape.style === 'rounds' ? `丸の数: ${shape.circleCount}` : '根元・中間点・先端をドラッグして調整',
  panelActions: () => [],

  edit: {
    hitHandle(shape, test) {
      const index = [shape.start, shape.control, shape.tip].findIndex(point => test.near(point.x, point.y));
      return index < 0 ? null : { mode: 'vertex', vertexIndex: index };
    },
    containsPoint(shape, point, slack) {
      const geometry = buildGeometry(shape);
      if (shape.style === 'rounds') {
        return geometry.circles.some(circle => Math.hypot(point.x - circle.x, point.y - circle.y) <= circle.radius + slack);
      }
      return pointInPolygon(point, geometry.pointed);
    },
    dragHandle({ mode, before, vertexIndex, point }) {
      if (mode !== 'vertex' || vertexIndex === undefined) return null;
      if (vertexIndex === 0) return { shape: { ...before, start: { x: point.x, y: point.y } } };
      if (vertexIndex === 1) return { shape: { ...before, control: { x: point.x, y: point.y } } };
      if (vertexIndex === 2) return { shape: { ...before, tip: { x: point.x, y: point.y } } };
      return null;
    },
    vertexCount: () => 3,
    insertionPoints: () => [],
    deleteVertex: () => null,
  },
};
