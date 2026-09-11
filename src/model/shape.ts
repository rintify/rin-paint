export type ShapeKind = 'line' | 'rect' | 'ellipse';

export interface LineShapeParams {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export interface RectShapeParams {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
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
  /** 中心基準の回転角（ラジアン） */
  rotation?: number;
}

export type ShapeParams = LineShapeParams | RectShapeParams | EllipseShapeParams;
