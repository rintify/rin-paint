import { normalizeShapePaintMode, type RectShapeParams, type ShapePoint } from '../../../model';
import { centeredCorners, pointsBounds, rotateAround } from '../geometry';
import {
  appendRoundedClosedPolyline,
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

const fields = shapeFields<RectShapeParams>('rect');

function center(shape: RectShapeParams): ShapePoint {
  return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
}

function corners(shape: RectShapeParams): ShapePoint[] {
  return centeredCorners(center(shape), shape.width / 2, shape.height / 2, shape.rotation ?? 0);
}

/** 四角形。中心基準で回転し、四隅ハンドルで伸縮する。 */
export const rectShapeKind: ShapeKindHandler<RectShapeParams> = {
  kind: 'rect',
  label: '四角形',
  fillable: true,

  fromDrag(a, b, style) {
    const box = dragBounds(a, b);
    if (!box) return null;
    return {
      kind: 'rect', x: box.x, y: box.y, width: box.w, height: box.h,
      color: style.color, strokeWidth: style.strokeWidth, rotation: 0, paintMode: style.paintMode,
    };
  },

  normalize: shape => ({ ...shape, rotation: shape.rotation ?? 0, cornerRadius: Math.max(0, shape.cornerRadius ?? 0) }),

  draw(ctx, shape, artboard) {
    paintClosed(ctx, normalizeShapePaintMode(shape.paintMode), artboard, () => appendRoundedClosedPolyline(ctx, corners(shape), shape.cornerRadius ?? 0));
  },

  paintMode: shape => normalizeShapePaintMode(shape.paintMode),
  setPaintMode: (shape, mode) => ({ ...shape, paintMode: mode }),

  bounds: shape => pointsBounds(corners(shape)),
  center,
  points: corners,

  rotation: shape => shape.rotation ?? 0,
  setRotation: (shape, angle) => ({ ...shape, rotation: angle }),

  rotate(shape, angle, pivot) {
    const moved = rotateAround(center(shape).x, center(shape).y, pivot, angle);
    return { ...shape, x: moved.x - shape.width / 2, y: moved.y - shape.height / 2, rotation: (shape.rotation ?? 0) + angle };
  },

  translate: (shape, dx, dy) => ({ ...shape, x: shape.x + dx, y: shape.y + dy }),

  scale: (shape, factor) => ({
    ...shape,
    x: shape.x * factor, y: shape.y * factor,
    width: shape.width * factor, height: shape.height * factor,
    strokeWidth: shape.strokeWidth * factor,
    cornerRadius: (shape.cornerRadius ?? 0) * factor,
  }),

  transform(shape, { transform, scale, angle }) {
    const moved = transform(shape.x + shape.width / 2, shape.y + shape.height / 2);
    const w = shape.width * scale, h = shape.height * scale;
    return {
      ...shape,
      x: moved.x - w / 2, y: moved.y - h / 2, width: w, height: h,
      strokeWidth: shape.strokeWidth * scale, rotation: (shape.rotation ?? 0) + angle,
      cornerRadius: (shape.cornerRadius ?? 0) * scale,
    };
  },

  parameterFields: () => [
    fields.parameter('rect.x', 'X', s => s.x, (s, v) => ({ ...s, x: v }), undefined, true),
    fields.parameter('rect.y', 'Y', s => s.y, (s, v) => ({ ...s, y: v }), undefined, true),
    fields.parameter('rect.width', '幅', s => s.width, (s, v) => ({ ...s, width: Math.max(.1, v) }), .1, true),
    fields.parameter('rect.height', '高さ', s => s.height, (s, v) => ({ ...s, height: Math.max(.1, v) }), .1, true),
  ],

  controlFields: shape => [
    fields.control('X', shape.x, (s, v) => ({ ...s, x: v }), undefined, true),
    fields.control('Y', shape.y, (s, v) => ({ ...s, y: v }), undefined, true),
    fields.control('幅', shape.width, (s, v) => ({ ...s, width: Math.max(.1, v) }), .1, true),
    fields.control('高さ', shape.height, (s, v) => ({ ...s, height: Math.max(.1, v) }), .1, true),
    rotationControlField(shape.rotation ?? 0),
  ],

  panelNote: () => null,
  panelActions: () => [{ id: 'convertToPolygon', label: '多角形に変換' }],

  edit: {
    ...NO_VERTICES,

    hitHandle: (shape, test) => hitCorner(corners(shape), test),

    containsPoint: (shape, point, slack) => withinBounds(pointsBounds(corners(shape)), point, slack),

    dragHandle({ mode, before, point }) {
      const size = resizeByCorner(mode, center(before), before.rotation ?? 0, before.width / 2, before.height / 2, point);
      if (!size) return null;
      return { shape: { ...before, x: size.cx - size.w / 2, y: size.cy - size.h / 2, width: size.w, height: size.h } };
    },
  },
};
