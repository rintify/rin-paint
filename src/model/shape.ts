export type ShapeKind = 'line' | 'rect' | 'ellipse' | 'polygon';

export type ShapePaintMode = 'stroke' | 'fill-inside' | 'fill-outside';
export type ShapeStrokeJoin = 'round' | 'miter';

export interface ShapePoint {
  x: number;
  y: number;
}

export interface LineShapeParams {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  strokeWidth: number;
  strokeJoin?: ShapeStrokeJoin;
}

export interface RectShapeParams {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
  strokeJoin?: ShapeStrokeJoin;
  /** 図形本体の角丸半径（canvas px） */
  cornerRadius?: number;
  paintMode: ShapePaintMode;
  /** 中心基準の回転角（ラジアン） */
  rotation?: number;
}

export interface EllipseShapeParams {
  kind: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  color: string;
  strokeWidth: number;
  strokeJoin?: ShapeStrokeJoin;
  paintMode: ShapePaintMode;
  /** 中心基準の回転角（ラジアン） */
  rotation?: number;
}

export interface PolygonShapeParams {
  kind: 'polygon';
  cx: number;
  cy: number;
  /** 中心座標からの相対頂点。3点以上、自己交差なし。 */
  points: ShapePoint[];
  color: string;
  strokeWidth: number;
  strokeJoin?: ShapeStrokeJoin;
  /** 図形本体の角丸半径（canvas px） */
  cornerRadius?: number;
  paintMode: ShapePaintMode;
  /** 中心基準の回転角（ラジアン） */
  rotation?: number;
}

export type ShapeParams =
  | LineShapeParams
  | RectShapeParams
  | EllipseShapeParams
  | PolygonShapeParams;

export function normalizeShapePaintMode(value: unknown): ShapePaintMode {
  return value === 'fill-inside' || value === 'fill-outside' ? value : 'stroke';
}

export function normalizeShapeStrokeJoin(value: unknown): ShapeStrokeJoin {
  return value === 'miter' ? 'miter' : 'round';
}
