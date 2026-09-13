import { normalizeShapePaintMode, type EllipseShapeParams, type ShapePoint } from '../../../model';
import { centeredCorners, rotateAround } from '../geometry';
import {
  dragBounds,
  hitCorner,
  NO_VERTICES,
  paintClosed,
  resizeByCorner,
  rotationControlField,
  shapeFields,
  withinBounds,
} from './common';
import type { ShapeKindHandler } from './types';

const fields = shapeFields<EllipseShapeParams>('ellipse');

function center(shape: EllipseShapeParams): ShapePoint {
  return { x: shape.cx, y: shape.cy };
}

function corners(shape: EllipseShapeParams): ShapePoint[] {
  return centeredCorners(center(shape), shape.rx, shape.ry, shape.rotation ?? 0);
}

/** 回転した楕円の外接矩形。半径を回転角で合成して解析的に求める */
function bounds(shape: EllipseShapeParams) {
  const a = shape.rotation ?? 0;
  const rx = Math.sqrt(shape.rx ** 2 * Math.cos(a) ** 2 + shape.ry ** 2 * Math.sin(a) ** 2);
  const ry = Math.sqrt(shape.rx ** 2 * Math.sin(a) ** 2 + shape.ry ** 2 * Math.cos(a) ** 2);
  return { x: shape.cx - rx, y: shape.cy - ry, w: rx * 2, h: ry * 2 };
}

/** 楕円。外接矩形の四隅ハンドルで伸縮する。 */
export const ellipseShapeKind: ShapeKindHandler<EllipseShapeParams> = {
  kind: 'ellipse',
  label: '楕円',
  fillable: true,

  fromDrag(a, b, style) {
    const box = dragBounds(a, b);
    if (!box) return null;
    return {
      kind: 'ellipse', cx: box.x + box.w / 2, cy: box.y + box.h / 2, rx: box.w / 2, ry: box.h / 2,
      color: style.color, strokeWidth: style.strokeWidth, rotation: 0, paintMode: style.paintMode,
    };
  },

  normalize: shape => ({ ...shape, rotation: shape.rotation ?? 0 }),

  draw(ctx, shape, pageFrame) {
    paintClosed(ctx, normalizeShapePaintMode(shape.paintMode), pageFrame, () => {
      ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, shape.rotation ?? 0, 0, Math.PI * 2);
    });
  },

  paintMode: shape => normalizeShapePaintMode(shape.paintMode),
  setPaintMode: (shape, mode) => ({ ...shape, paintMode: mode }),

  bounds,
  center,
  points: corners,

  rotation: shape => shape.rotation ?? 0,
  setRotation: (shape, angle) => ({ ...shape, rotation: angle }),

  rotate(shape, angle, pivot) {
    const moved = rotateAround(shape.cx, shape.cy, pivot, angle);
    return { ...shape, cx: moved.x, cy: moved.y, rotation: (shape.rotation ?? 0) + angle };
  },

  translate: (shape, dx, dy) => ({ ...shape, cx: shape.cx + dx, cy: shape.cy + dy }),

  scale: (shape, factor) => ({
    ...shape,
    cx: shape.cx * factor, cy: shape.cy * factor,
    rx: shape.rx * factor, ry: shape.ry * factor,
    strokeWidth: shape.strokeWidth * factor,
  }),

  transform(shape, { transform, scale, angle }) {
    const moved = transform(shape.cx, shape.cy);
    return {
      ...shape,
      cx: moved.x, cy: moved.y, rx: shape.rx * scale, ry: shape.ry * scale,
      strokeWidth: shape.strokeWidth * scale, rotation: (shape.rotation ?? 0) + angle,
    };
  },

  parameterFields: () => [
    fields.parameter('ellipse.cx', '中心 X', s => s.cx, (s, v) => ({ ...s, cx: v }), undefined, true),
    fields.parameter('ellipse.cy', '中心 Y', s => s.cy, (s, v) => ({ ...s, cy: v }), undefined, true),
    fields.parameter('ellipse.rx', '横半径', s => s.rx, (s, v) => ({ ...s, rx: Math.max(.1, v) }), .1, true),
    fields.parameter('ellipse.ry', '縦半径', s => s.ry, (s, v) => ({ ...s, ry: Math.max(.1, v) }), .1, true),
  ],

  controlFields: shape => [
    fields.control('中心 X', shape.cx, (s, v) => ({ ...s, cx: v }), undefined, true),
    fields.control('中心 Y', shape.cy, (s, v) => ({ ...s, cy: v }), undefined, true),
    fields.control('横半径', shape.rx, (s, v) => ({ ...s, rx: Math.max(.1, v) }), .1, true),
    fields.control('縦半径', shape.ry, (s, v) => ({ ...s, ry: Math.max(.1, v) }), .1, true),
    rotationControlField(shape.rotation ?? 0),
  ],

  panelNote: () => null,
  panelActions: () => [],

  edit: {
    ...NO_VERTICES,

    hitHandle: (shape, test) => hitCorner(corners(shape), test),

    containsPoint: (shape, point, slack) => withinBounds(bounds(shape), point, slack),

    dragHandle({ mode, before, point }) {
      const size = resizeByCorner(mode, center(before), before.rotation ?? 0, before.rx, before.ry, point);
      if (!size) return null;
      return { shape: { ...before, cx: size.cx, cy: size.cy, rx: size.w / 2, ry: size.h / 2 } };
    },
  },
};
