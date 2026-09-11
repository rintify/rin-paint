import type { ShapeKind, ShapeParams } from '../../../model';
import { ellipseShapeKind } from './ellipse';
import { lineShapeKind } from './line';
import { polygonShapeKind } from './polygon';
import { rectShapeKind } from './rect';
import type { ShapeKindHandler } from './types';

const HANDLERS: Record<ShapeKind, ShapeKindHandler> = {
  line: lineShapeKind,
  rect: rectShapeKind,
  ellipse: ellipseShapeKind,
  polygon: polygonShapeKind,
};

/** 図形実体から種類ハンドラを引く。幾何の分岐はすべてここを通る。 */
export function shapeKindHandler(shape: ShapeParams): ShapeKindHandler {
  return HANDLERS[shape.kind];
}

/** まだ図形が無い段階 (ツールのドラッグ開始時) 用 */
export function shapeKindHandlerOf(kind: ShapeKind): ShapeKindHandler {
  return HANDLERS[kind];
}
