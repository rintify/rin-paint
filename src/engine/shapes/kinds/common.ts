import type { ShapePaintMode, ShapeParams, ShapePoint, StrokePoint } from '../../../model';
import type { ShapeBounds } from '../geometry';
import type {
  ShapeArtboard,
  ShapeControlField,
  ShapeEditMode,
  ShapeHit,
  ShapeHitTest,
  ShapeParameterField,
} from './types';

/**
 * 種類を確かめてから絞った型で読み書きするフィールド生成器。パラメータ一覧も
 * 設定パレットも「別種の図形が来たら素通し」という同じ約束で書ける。
 */
export function shapeFields<S extends ShapeParams>(kind: S['kind']) {
  const narrow = (shape: ShapeParams): S | null => (shape.kind === kind ? (shape as S) : null);
  return {
    control(label: string, value: number, make: (shape: S, value: number) => S, min?: number): ShapeControlField {
      return {
        label,
        value,
        min,
        make: (input, shape) => { const own = narrow(shape); return own ? make(own, input) : shape; },
      };
    },
    parameter(
      key: string,
      label: string,
      read: (shape: S) => number,
      write: (shape: S, value: number) => S,
      min?: number,
    ): ShapeParameterField {
      return {
        key,
        label,
        min,
        read: shape => { const own = narrow(shape); return own ? read(own) : 0; },
        write: (shape, value) => { const own = narrow(shape); return own ? write(own, value) : shape; },
      };
    },
  };
}

/** 中心基準で回る種類が共有する「回転」フィールド */
export function rotationControlField(angle: number): ShapeControlField {
  return {
    label: '回転',
    value: angle * 180 / Math.PI,
    make: (value, shape) => shape.kind === 'line' ? shape : { ...shape, rotation: value * Math.PI / 180 },
  };
}

/** 閉じた図形の塗り分け。ctx のスタイルは呼び出し側が設定済み */
export function paintClosed(
  ctx: CanvasRenderingContext2D,
  mode: ShapePaintMode,
  artboard: ShapeArtboard,
  appendPath: () => void,
): void {
  ctx.beginPath();
  if (mode === 'fill-outside') ctx.rect(0, 0, artboard.w, artboard.h);
  appendPath();
  if (mode === 'stroke') ctx.stroke();
  else ctx.fill(mode === 'fill-outside' ? 'evenodd' : 'nonzero');
}

export function appendClosedPolyline(ctx: CanvasRenderingContext2D, points: ShapePoint[]): void {
  if (!points.length) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

export function withinBounds(bounds: ShapeBounds, point: ShapePoint, slack: number): boolean {
  return point.x >= bounds.x - slack && point.x <= bounds.x + bounds.w + slack
    && point.y >= bounds.y - slack && point.y <= bounds.y + bounds.h + slack;
}

/** 四隅ハンドルのヒット判定。points は centeredCorners と同じ左上まわりの順 */
export function hitCorner(corners: ShapePoint[], test: ShapeHitTest): ShapeHit | null {
  const modes = ['nw', 'ne', 'se', 'sw'] as const;
  const index = corners.findIndex(point => test.near(point.x, point.y));
  return index >= 0 ? { mode: modes[index] } : null;
}

/**
 * 角ハンドルのドラッグから、回転を保ったままの新しい中心とサイズを求める。
 * 対角側の角を固定したまま伸縮するので、矩形と楕円で同じ計算を使える。
 */
export function resizeByCorner(
  mode: ShapeEditMode,
  center: ShapePoint,
  angle: number,
  halfWidth: number,
  halfHeight: number,
  point: StrokePoint,
): { cx: number; cy: number; w: number; h: number } | null {
  if (mode !== 'nw' && mode !== 'ne' && mode !== 'sw' && mode !== 'se') return null;
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  const px = (point.x - center.x) * cos - (point.y - center.y) * sin;
  const py = (point.x - center.x) * sin + (point.y - center.y) * cos;
  const left = mode.endsWith('w') ? px : -halfWidth, right = mode.endsWith('e') ? px : halfWidth;
  const top = mode.startsWith('n') ? py : -halfHeight, bottom = mode.startsWith('s') ? py : halfHeight;
  const localX = (left + right) / 2, localY = (top + bottom) / 2;
  return {
    cx: center.x + localX * Math.cos(angle) - localY * Math.sin(angle),
    cy: center.y + localX * Math.sin(angle) + localY * Math.cos(angle),
    w: Math.max(.01, Math.abs(right - left)),
    h: Math.max(.01, Math.abs(bottom - top)),
  };
}

/** 2 点ドラッグを正規化した矩形。潰れていれば null */
export function dragBounds(a: StrokePoint, b: StrokePoint): ShapeBounds | null {
  const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  if (w === 0 || h === 0) return null;
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w, h };
}

/** 頂点を持たない種類の edit 既定値 */
export const NO_VERTICES = {
  vertexCount: () => 0,
  insertionPoints: () => [],
  deleteVertex: () => null,
} as const;
