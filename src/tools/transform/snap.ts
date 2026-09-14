import {
  type Point, type SnapLines, snapTranslation,
} from '../../engine/shapes/snap';

export function pointBounds(points: Point[]) {
  const x = Math.min(...points.map(p => p.x));
  const y = Math.min(...points.map(p => p.y));
  return {
    x, y,
    w: Math.max(...points.map(p => p.x)) - x,
    h: Math.max(...points.map(p => p.y)) - y,
  };
}

/** Keep the center and aspect ratio fixed while snapping the grabbed corner. */
export function snapUniformScale(
  corner: Point, center: Point, scale: number, lines: SnapLines, tolerance: number,
) {
  const vx = corner.x - center.x, vy = corner.y - center.y;
  const radius = Math.hypot(vx, vy);
  let best: { scale: number; distance: number; rank: number } | null = null;
  for (const axis of ['x', 'y'] as const) {
    const delta = axis === 'x' ? vx : vy;
    if (Math.abs(delta) < 1e-8) continue;
    for (const line of lines[axis]) {
      const candidate = (line.value - center[axis]) / delta;
      const distance = Math.abs(candidate - scale) * radius;
      if (candidate < 0.05 || candidate > 20 || distance > tolerance) continue;
      if (!best || distance < best.distance - 1e-9
        || (Math.abs(distance - best.distance) <= 1e-9 && line.rank < best.rank)) {
        best = { scale: candidate, distance, rank: line.rank };
      }
    }
  }
  const next = best?.scale ?? scale;
  const point = { x: center.x + vx * next, y: center.y + vy * next };
  // Only show guides actually reached by the constrained scale.
  const guides = snapTranslation({ ...point, w: 0, h: 0 }, 0, 0, lines, 1e-7);
  return { scale: next, xGuide: guides.xGuide, yGuide: guides.yGuide };
}
