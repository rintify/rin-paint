import type { LineShapeParams, ShapePoint } from '../../../model';
import { rotateAround } from '../geometry';
import { NO_VERTICES, shapeFields, withinBounds } from './common';
import type { ShapeKindHandler } from './types';

const fields = shapeFields<LineShapeParams>('line');

function center(shape: LineShapeParams): ShapePoint {
  return { x: (shape.x1 + shape.x2) / 2, y: (shape.y1 + shape.y2) / 2 };
}

function bounds(shape: LineShapeParams) {
  return {
    x: Math.min(shape.x1, shape.x2),
    y: Math.min(shape.y1, shape.y2),
    w: Math.abs(shape.x2 - shape.x1),
    h: Math.abs(shape.y2 - shape.y1),
  };
}

/** 直線。両端を動かすだけで、塗りも中心基準の回転も持たない。 */
export const lineShapeKind: ShapeKindHandler<LineShapeParams> = {
  kind: 'line',
  label: '直線',
  fillable: false,

  fromDrag(a, b, style) {
    if (a.x === b.x && a.y === b.y) return null;
    return { kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: style.color, strokeWidth: style.strokeWidth };
  },

  normalize: shape => shape,

  draw(ctx, shape) {
    ctx.beginPath();
    ctx.moveTo(shape.x1, shape.y1);
    ctx.lineTo(shape.x2, shape.y2);
    ctx.stroke();
  },

  paintMode: () => 'stroke',
  setPaintMode: shape => shape,

  bounds,
  center,
  points: shape => [{ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }],

  rotation: shape => Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1),

  setRotation(shape, angle) {
    const mid = center(shape), half = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) / 2;
    const dx = half * Math.cos(angle), dy = half * Math.sin(angle);
    return { ...shape, x1: mid.x - dx, y1: mid.y - dy, x2: mid.x + dx, y2: mid.y + dy };
  },

  rotate(shape, angle, pivot) {
    const a = rotateAround(shape.x1, shape.y1, pivot, angle);
    const b = rotateAround(shape.x2, shape.y2, pivot, angle);
    return { ...shape, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  },

  translate: (shape, dx, dy) => ({ ...shape, x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy }),

  scale: (shape, factor) => ({
    ...shape,
    x1: shape.x1 * factor, y1: shape.y1 * factor,
    x2: shape.x2 * factor, y2: shape.y2 * factor,
    strokeWidth: shape.strokeWidth * factor,
  }),

  transform(shape, { transform, scale }) {
    const a = transform(shape.x1, shape.y1), b = transform(shape.x2, shape.y2);
    return { ...shape, x1: a.x, y1: a.y, x2: b.x, y2: b.y, strokeWidth: shape.strokeWidth * scale };
  },

  parameterFields: () => [
    fields.parameter('line.x1', '開始 X', s => s.x1, (s, v) => ({ ...s, x1: v })),
    fields.parameter('line.y1', '開始 Y', s => s.y1, (s, v) => ({ ...s, y1: v })),
    fields.parameter('line.x2', '終了 X', s => s.x2, (s, v) => ({ ...s, x2: v })),
    fields.parameter('line.y2', '終了 Y', s => s.y2, (s, v) => ({ ...s, y2: v })),
  ],

  controlFields(shape) {
    const length = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
    const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
    return [
      fields.control('開始 X', shape.x1, (s, v) => ({ ...s, x1: v })),
      fields.control('開始 Y', shape.y1, (s, v) => ({ ...s, y1: v })),
      fields.control('終了 X', shape.x2, (s, v) => ({ ...s, x2: v })),
      fields.control('終了 Y', shape.y2, (s, v) => ({ ...s, y2: v })),
      fields.control('長さ', length, (s, v) => ({
        ...s,
        x2: s.x1 + Math.max(0, v) * Math.cos(angle),
        y2: s.y1 + Math.max(0, v) * Math.sin(angle),
      }), 0),
      fields.control('角度', angle * 180 / Math.PI, (s, v) => ({
        ...s,
        x2: s.x1 + length * Math.cos(v * Math.PI / 180),
        y2: s.y1 + length * Math.sin(v * Math.PI / 180),
      })),
    ];
  },

  panelNote: () => null,
  panelActions: () => [],

  edit: {
    ...NO_VERTICES,

    hitHandle(shape, test) {
      if (test.near(shape.x1, shape.y1)) return { mode: 'start' };
      if (test.near(shape.x2, shape.y2)) return { mode: 'end' };
      return null;
    },

    containsPoint: (shape, point, slack) => withinBounds(bounds(shape), point, slack),

    dragHandle({ mode, before, point }) {
      if (mode === 'start') return { shape: { ...before, x1: point.x, y1: point.y } };
      if (mode === 'end') return { shape: { ...before, x2: point.x, y2: point.y } };
      return null;
    },
  },
};
