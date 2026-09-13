import { normalizeShapePaintMode, type PolygonShapeParams, type ShapePoint } from '../../../model';
import { cloneShape, pointInPolygon, pointsBounds, polygonSelfIntersects, rotateAround } from '../geometry';
import {
  appendRoundedClosedPolyline,
  paintClosed,
  rotationControlField,
  shapeFields,
} from './common';
import type { ShapeKindHandler } from './types';

const fields = shapeFields<PolygonShapeParams>('polygon');

function center(shape: PolygonShapeParams): ShapePoint {
  return { x: shape.cx, y: shape.cy };
}

/** 中心相対の頂点を回転させてアートボード座標へ移す */
function worldPoints(shape: PolygonShapeParams): ShapePoint[] {
  const angle = shape.rotation ?? 0;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return shape.points.map((point) => ({ x: shape.cx + point.x * cos - point.y * sin, y: shape.cy + point.x * sin + point.y * cos }));
}

function midpoints(points: ShapePoint[]): ShapePoint[] {
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
  });
}

/** 多角形。頂点の移動・追加・削除ができ、自己交差は常に拒む。 */
export const polygonShapeKind: ShapeKindHandler<PolygonShapeParams> = {
  kind: 'polygon',
  label: '多角形',
  fillable: true,

  normalize: shape => ({ ...shape, rotation: shape.rotation ?? 0, cornerRadius: Math.max(0, shape.cornerRadius ?? 0) }),

  draw(ctx, shape, pageFrame) {
    paintClosed(ctx, normalizeShapePaintMode(shape.paintMode), pageFrame, () => appendRoundedClosedPolyline(ctx, worldPoints(shape), shape.cornerRadius ?? 0));
  },

  paintMode: shape => normalizeShapePaintMode(shape.paintMode),
  setPaintMode: (shape, mode) => ({ ...shape, paintMode: mode }),

  bounds: shape => pointsBounds(worldPoints(shape)),
  center,
  points: worldPoints,

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
    points: shape.points.map(point => ({ x: point.x * factor, y: point.y * factor })),
    strokeWidth: shape.strokeWidth * factor,
    cornerRadius: (shape.cornerRadius ?? 0) * factor,
  }),

  transform(shape, { transform, scale, angle }) {
    const moved = transform(shape.cx, shape.cy);
    return {
      ...shape,
      cx: moved.x, cy: moved.y,
      points: shape.points.map(point => ({ x: point.x * scale, y: point.y * scale })),
      strokeWidth: shape.strokeWidth * scale, rotation: (shape.rotation ?? 0) + angle,
      cornerRadius: (shape.cornerRadius ?? 0) * scale,
    };
  },

  parameterFields: () => [
    fields.parameter('polygon.cx', '中心 X', s => s.cx, (s, v) => ({ ...s, cx: v }), undefined, true),
    fields.parameter('polygon.cy', '中心 Y', s => s.cy, (s, v) => ({ ...s, cy: v }), undefined, true),
  ],

  controlFields: shape => [
    fields.control('中心 X', shape.cx, (s, v) => ({ ...s, cx: v }), undefined, true),
    fields.control('中心 Y', shape.cy, (s, v) => ({ ...s, cy: v }), undefined, true),
    rotationControlField(shape.rotation ?? 0),
  ],

  panelNote: shape => `頂点数: ${shape.points.length}`,
  panelActions: () => [],

  edit: {
    invalidMessage: '自己交差する位置は使えないため、直前の有効位置へ戻しました',

    /** 頂点そのもの、または掴むと頂点が増える辺の中点を拾う */
    hitHandle(shape, test) {
      const world = worldPoints(shape);
      const vertex = world.findIndex(point => test.near(point.x, point.y));
      if (vertex >= 0) return { mode: 'vertex', vertexIndex: vertex };
      const edge = midpoints(world).findIndex(point => test.near(point.x, point.y));
      if (edge < 0) return null;
      const a = shape.points[edge], b = shape.points[(edge + 1) % shape.points.length];
      const index = edge + 1;
      return {
        mode: 'vertex',
        vertexIndex: index,
        shape: { ...shape, points: [...shape.points.slice(0, index), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ...shape.points.slice(index)] },
      };
    },

    containsPoint: (shape, point) => pointInPolygon(point, worldPoints(shape)),

    dragHandle({ mode, before, current, vertexIndex, point }) {
      if (mode !== 'vertex' || vertexIndex === undefined) return null;
      const next = cloneShape(current.kind === 'polygon' ? current : before);
      const angle = -(next.rotation ?? 0), dx = point.x - next.cx, dy = point.y - next.cy;
      next.points[vertexIndex] = { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: dx * Math.sin(angle) + dy * Math.cos(angle) };
      return { shape: next, invalid: polygonSelfIntersects(next.points) };
    },

    vertexCount: shape => shape.points.length,
    insertionPoints: shape => midpoints(worldPoints(shape)),

    deleteVertex(shape, index) {
      if (shape.points.length <= 3 || index >= shape.points.length) return null;
      const points = shape.points.filter((_, at) => at !== index);
      if (polygonSelfIntersects(points)) return { error: '自己交差するためこの頂点は削除できません' };
      return { shape: { ...shape, points } };
    },
  },
};
