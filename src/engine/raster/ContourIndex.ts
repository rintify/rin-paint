import type { PixelRect } from './geometry';
type Point = { x: number; y: number };
export interface ContourEdge {
  contour: Point[];
  index: number;
  orientation: number;
  bounds: PixelRect;
}
interface Node {
  bounds: PixelRect;
  left?: Node;
  right?: Node;
  edges?: ContourEdge[];
}
function overlaps(a: PixelRect, b: PixelRect): boolean {
  return (
    a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y
  );
}
function bounds(edges: ContourEdge[]): PixelRect {
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const edge of edges) {
    const b = edge.bounds;
    x = Math.min(x, b.x);
    y = Math.min(y, b.y);
    right = Math.max(right, b.x + b.w);
    bottom = Math.max(bottom, b.y + b.h);
  }
  return { x, y, w: right - x, h: bottom - y };
}
function build(edges: ContourEdge[]): Node {
  const box = bounds(edges);
  if (edges.length <= 16) return { bounds: box, edges };
  const axis = box.w >= box.h ? 'x' : 'y';
  edges.sort((a, b) => a.bounds[axis] - b.bounds[axis]);
  const middle = edges.length >> 1;
  return {
    bounds: box,
    left: build(edges.slice(0, middle)),
    right: build(edges.slice(middle)),
  };
}
/** Geometry-only BVH: storage and construction never enumerate intervening empty tiles. */
export class ContourIndex {
  private root: Node | null;
  constructor(contours: Point[][]) {
    const edges: ContourEdge[] = [];
    for (const contour of contours) {
      let area = 0;
      for (let i = 0; i < contour.length; i++) {
        const a = contour[i],
          b = contour[(i + 1) % contour.length];
        area += a.x * b.y - b.x * a.y;
      }
      const orientation = Math.sign(area) || 1;
      for (let index = 0; index < contour.length; index++) {
        const a = contour[index],
          b = contour[(index + 1) % contour.length];
        edges.push({
          contour,
          index,
          orientation,
          bounds: {
            x: Math.min(a.x, b.x),
            y: Math.min(a.y, b.y),
            w: Math.abs(a.x - b.x),
            h: Math.abs(a.y - b.y),
          },
        });
      }
    }
    this.root = edges.length ? build(edges) : null;
  }
  *query(rect: PixelRect): Generator<ContourEdge> {
    const pending = this.root ? [this.root] : [];
    while (pending.length) {
      const node = pending.pop()!;
      if (!overlaps(node.bounds, rect)) continue;
      if (node.edges) {
        for (const edge of node.edges)
          if (overlaps(edge.bounds, rect)) yield edge;
      } else {
        if (node.left) pending.push(node.left);
        if (node.right) pending.push(node.right);
      }
    }
  }
}
