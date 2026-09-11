import type { ShapeBounds } from './geometry';

export interface Point {
  x: number;
  y: number;
}

export interface SnapLine {
  value: number;
  /** 小さいほど優先。画布は 0、既存レイヤーは出現順の 1, 2, ... */
  rank: number;
}

export interface SnapLines {
  x: SnapLine[];
  y: SnapLine[];
}

export interface SnapMoveResult {
  dx: number;
  dy: number;
  xGuide: number | null;
  yGuide: number | null;
}

export interface SnapAngleResult {
  angle: number;
  snapped: boolean;
}

const ZERO_EDGE = 1e-8;

/** 軸平行外接矩形の左・中央・右 / 上・中央・下 */
export function boundsAnchors(bounds: ShapeBounds): { x: number[]; y: number[] } {
  return {
    x: [bounds.x, bounds.x + bounds.w / 2, bounds.x + bounds.w],
    y: [bounds.y, bounds.y + bounds.h / 2, bounds.y + bounds.h],
  };
}

function linesFromValues(values: number[], rank: number): SnapLine[] {
  return values.map(value => ({ value, rank }));
}

/** 画布と他図形の外接矩形から、X/Y の吸着候補をレイヤー順で作る */
export function collectSnapLines(artboard: { w: number; h: number }, others: ShapeBounds[]): SnapLines {
  const x = linesFromValues([0, artboard.w / 2, artboard.w], 0);
  const y = linesFromValues([0, artboard.h / 2, artboard.h], 0);
  others.forEach((bounds, index) => {
    const anchors = boundsAnchors(bounds);
    x.push(...linesFromValues(anchors.x, index + 1));
    y.push(...linesFromValues(anchors.y, index + 1));
  });
  return { x, y };
}

function pickSnap(anchors: number[], lines: SnapLine[], tolerance: number): { correction: number; guide: number } | null {
  let best: { abs: number; correction: number; guide: number; rank: number } | null = null;
  for (const anchor of anchors) {
    for (const line of lines) {
      const correction = line.value - anchor;
      const abs = Math.abs(correction);
      if (abs > tolerance) continue;
      if (
        !best
        || abs < best.abs - 1e-9
        || (Math.abs(abs - best.abs) <= 1e-9 && line.rank < best.rank)
      ) {
        best = { abs, correction, guide: line.value, rank: line.rank };
      }
    }
  }
  return best ? { correction: best.correction, guide: best.guide } : null;
}

/** 生の移動量を、移動後アンカーと候補ラインの最近傍へ補正する */
export function snapTranslation(
  startBounds: ShapeBounds,
  dx: number,
  dy: number,
  lines: SnapLines,
  tolerance: number,
): SnapMoveResult {
  const moved: ShapeBounds = { x: startBounds.x + dx, y: startBounds.y + dy, w: startBounds.w, h: startBounds.h };
  const anchors = boundsAnchors(moved);
  const xHit = pickSnap(anchors.x, lines.x, tolerance);
  const yHit = pickSnap(anchors.y, lines.y, tolerance);
  return {
    dx: dx + (xHit?.correction ?? 0),
    dy: dy + (yHit?.correction ?? 0),
    xGuide: xHit?.guide ?? null,
    yGuide: yHit?.guide ?? null,
  };
}

/** 絶対角度を最寄りの 90° 倍数へ、閾値以内なら吸着する */
export function snapAngleToRightAngles(angle: number, thresholdDeg = 5): SnapAngleResult {
  const deg = angle * 180 / Math.PI;
  const nearest = Math.round(deg / 90) * 90;
  if (Math.abs(deg - nearest) <= thresholdDeg) {
    return { angle: nearest * Math.PI / 180, snapped: true };
  }
  return { angle, snapped: false };
}

/**
 * ドラッグ開始点を一方の角として固定し、長い方の辺に揃えた正方形・正円用の終点。
 * 片軸が 0 のときはその軸を正方向とみなし、水平・垂直ドラッグでも面積を確保する。
 */
export function constrainAxisAlignedAspect<T extends Point>(start: Point, end: T): T {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  const sx = dx === 0 ? 1 : Math.sign(dx);
  const sy = dy === 0 ? 1 : Math.sign(dy);
  return { ...end, x: start.x + sx * size, y: start.y + sy * size };
}

/** 点を a-b の無限直線へ正射影する。辺が潰れていれば null */
export function projectPointToInfiniteLine(point: Point, a: Point, b: Point): { point: Point; distance: number } | null {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (!(len2 > ZERO_EDGE)) return null;
  const t = ((point.x - a.x) * vx + (point.y - a.y) * vy) / len2;
  const x = a.x + t * vx;
  const y = a.y + t * vy;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { point: { x, y }, distance: Math.hypot(point.x - x, point.y - y) };
}

/**
 * 選択頂点と前後頂点が定める 2 直線のうち、ポインターに近い方へ射影する。
 * 等距離なら前頂点側。どちらも無効なら自由点を返す。
 */
export function constrainVertexToEdges(point: Point, prev: Point, selected: Point, next: Point): Point {
  const toPrev = projectPointToInfiniteLine(point, selected, prev);
  const toNext = projectPointToInfiniteLine(point, selected, next);
  if (!toPrev && !toNext) return point;
  if (!toPrev) return toNext!.point;
  if (!toNext) return toPrev.point;
  return toNext.distance < toPrev.distance ? toNext.point : toPrev.point;
}
