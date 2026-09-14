import type { RasterSurface } from '../raster/RasterSurface';
import {
  TILE_SIZE,
  tileKey,
  tileCoordinates,
  tileRect,
} from '../raster/geometry';
import { mmToPx, SIZE_MM_MAX } from '../units';
import type {
  CanvasLease,
  EffectScope,
  LayerDrawEnv,
  MaskCanvas,
} from './types';

/** Bounds and Canvas stroke use the same cap so sharp tips are never cropped. */
export const SHARP_OUTLINE_MITER_LIMIT = 12;
const OUTLINE_CACHE_VERSION = 2;
const contourBoundsCache = new WeakMap<
  object,
  { x: number; y: number; w: number; h: number }
>();

function clear(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, width, height);
  ctx.restore();
}

export function copyCanvas(
  env: LayerDrawEnv,
  source: HTMLCanvasElement,
): CanvasLease {
  const lease = env.borrowCanvas();
  lease.ctx.drawImage(source, 0, 0);
  return lease;
}

export function replaceCanvas(
  target: HTMLCanvasElement,
  source: CanvasImageSource,
): void {
  const ctx = target.getContext('2d')!;
  clear(ctx, target.width, target.height);
  ctx.drawImage(source, 0, 0);
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function subtractOpaque(ctx: CanvasRenderingContext2D, strength: number): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = strength;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

function drawMask(
  ctx: CanvasRenderingContext2D,
  mask: MaskCanvas,
  scope: EffectScope,
  operation: GlobalCompositeOperation,
  strength = 1,
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = operation;
  ctx.globalAlpha = clampUnit(strength) * mask.opacity;
  ctx.drawImage(
    mask.canvas,
    scope.x - mask.x,
    scope.y - mask.y,
    scope.width,
    scope.height,
    0,
    0,
    scope.width,
    scope.height,
  );
  ctx.restore();
}

/** premultiplied-alphaのままCanvas合成で線形混合する。 */
export function mixCanvases(
  scope: EffectScope,
  effected: HTMLCanvasElement,
  strength: number,
  mask: MaskCanvas | null,
): void {
  const opacity = clampUnit(strength);
  if (opacity <= 0) return;
  const targetCtx = scope.canvas.getContext('2d')!;
  const effectedCtx = effected.getContext('2d')!;
  if (mask) {
    drawMask(targetCtx, mask, scope, 'destination-out', opacity);
    drawMask(effectedCtx, mask, scope, 'destination-in', opacity);
  } else {
    subtractOpaque(targetCtx, opacity);
  }
  targetCtx.save();
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  targetCtx.globalCompositeOperation = 'lighter';
  targetCtx.globalAlpha = mask ? 1 : opacity;
  targetCtx.drawImage(effected, 0, 0);
  targetCtx.restore();
}

export function applyClip(
  scope: EffectScope,
  mask: MaskCanvas,
  opacity: number,
  env: LayerDrawEnv,
): void {
  const strength = clampUnit(opacity);
  if (strength <= 0) return;
  const ctx = scope.canvas.getContext('2d')!;
  if (strength >= 1) {
    drawMask(ctx, mask, scope, 'destination-in');
    return;
  }
  const clipped = copyCanvas(env, scope.canvas);
  drawMask(clipped.ctx, mask, scope, 'destination-in');
  subtractOpaque(ctx, strength);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = strength;
  ctx.drawImage(clipped.canvas, 0, 0);
  ctx.restore();
  clipped.release();
}

function distanceTransform1d(
  input: Float64Array,
  output: Float64Array,
  length: number,
  sites: Int32Array,
  bounds: Float64Array,
): void {
  let k = 0;
  sites[0] = 0;
  bounds[0] = -Infinity;
  bounds[1] = Infinity;
  for (let q = 1; q < length; q++) {
    let site = sites[k];
    let split =
      (input[q] + q * q - (input[site] + site * site)) / (2 * (q - site));
    while (split <= bounds[k] && k > 0) {
      k--;
      site = sites[k];
      split =
        (input[q] + q * q - (input[site] + site * site)) / (2 * (q - site));
    }
    k++;
    sites[k] = q;
    bounds[k] = split;
    bounds[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < length; q++) {
    while (bounds[k + 1] < q) k++;
    const delta = q - sites[k];
    output[q] = delta * delta + input[sites[k]];
  }
}

function parseHex(color: string): [number, number, number] {
  const value = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : '000000';
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

interface OutlineDistanceField {
  x: number;
  y: number;
  width: number;
  height: number;
  seedMinX: number;
  seedMinY: number;
  seedMaxX: number;
  seedMaxY: number;
  squared: Float32Array | null;
  contours: Array<Array<{ x: number; y: number }>>;
}

interface ContourNode {
  point: { x: number; y: number };
  segmentIds: number[];
}

interface ContourSegment {
  a: string;
  b: string;
}

function perpendicularDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-8)
    return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    ),
  );
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}

function simplifyOpenPath(
  points: Array<{ x: number; y: number }>,
  tolerance: number,
): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const ranges: Array<[number, number]> = [[0, points.length - 1]];
  while (ranges.length) {
    const [start, end] = ranges.pop()!;
    let farthest = -1,
      farthestDistance = tolerance;
    for (let index = start + 1; index < end; index++) {
      const distance = perpendicularDistance(
        points[index],
        points[start],
        points[end],
      );
      if (distance > farthestDistance) {
        farthest = index;
        farthestDistance = distance;
      }
    }
    if (farthest < 0) continue;
    keep[farthest] = 1;
    ranges.push([start, farthest], [farthest, end]);
  }
  return points.filter((_, index) => keep[index]);
}

function lineIntersection(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): { x: number; y: number } | null {
  const abX = b.x - a.x,
    abY = b.y - a.y;
  const cdX = d.x - c.x,
    cdY = d.y - c.y;
  const denominator = abX * cdY - abY * cdX;
  if (Math.abs(denominator) < 1e-8) return null;
  const acX = c.x - a.x,
    acY = c.y - a.y;
  const t = (acX * cdY - acY * cdX) / denominator;
  return { x: a.x + abX * t, y: a.y + abY * t };
}

/** Reconstructs an acute vertex that threshold rasterization leaves as a 1–2 px flat cap. */
function sharpenRasterCaps(
  points: Array<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  if (points.length < 4) return points;
  let result = points;
  // A rasterized corner may become either one short cap or a two/three-segment
  // stair. Collapse the whole short run to the intersection of its supporting
  // edges. This preserves polygon corners without mistaking ordinary curved
  // contour segments (whose neighbouring segments have comparable lengths).
  for (let pass = 0; pass < points.length && result.length >= 4; pass++) {
    let sharpened: Array<{ x: number; y: number }> | null = null;
    for (let index = 0; index < result.length; index++) {
      const previous = result[(index - 1 + result.length) % result.length];
      const start = result[index];
      const beforeLength = Math.hypot(
        start.x - previous.x,
        start.y - previous.y,
      );
      let capLength = 0;
      for (
        let edgeCount = 1;
        edgeCount <= Math.min(3, result.length - 3);
        edgeCount++
      ) {
        const edgeStart = result[(index + edgeCount - 1) % result.length];
        const end = result[(index + edgeCount) % result.length];
        const edgeLength = Math.hypot(end.x - edgeStart.x, end.y - edgeStart.y);
        if (edgeLength > 2.5) break;
        capLength += edgeLength;
        if (capLength > 6) break;
        const next = result[(index + edgeCount + 1) % result.length];
        const afterLength = Math.hypot(next.x - end.x, next.y - end.y);
        if (beforeLength < capLength * 3 || afterLength < capLength * 3)
          continue;
        const apex = lineIntersection(previous, start, end, next);
        const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
        const maxExtension = Math.max(
          12,
          Math.min(beforeLength, afterLength) * 0.9,
        );
        if (
          !apex ||
          Math.hypot(apex.x - midpoint.x, apex.y - midpoint.y) > maxExtension
        )
          continue;
        sharpened = [apex];
        for (let offset = edgeCount + 1; offset < result.length; offset++) {
          sharpened.push(result[(index + offset) % result.length]);
        }
        break;
      }
      if (sharpened) break;
    }
    if (!sharpened) break;
    result = sharpened;
  }
  return result;
}

/**
 * Extracts a sub-pixel alpha contour with marching squares. Interpolating the
 * threshold crossing avoids the axis-aligned stair steps produced by tracing
 * whole pixel boxes.
 */
function traceAlphaContours(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  limit: number,
): Array<Array<{ x: number; y: number }>> {
  const sample = (gridX: number, gridY: number) => {
    const x = gridX - 1,
      y = gridY - 1;
    return x >= 0 && y >= 0 && x < width && y < height
      ? pixels[(y * width + x) * 4 + 3]
      : 0;
  };
  function* cells() {
    for (let y = 0; y <= height; y++)
      for (let x = 0; x <= width; x++) yield { x, y };
  }
  return traceContours(sample, cells(), limit);
}

export function traceSparseAlphaContours(
  surface: RasterSurface,
  limit: number,
): Array<Array<{ x: number; y: number }>> {
  const pixels = new Map<string, Uint8ClampedArray>(),
    candidates = new Map<string, { tx: number; ty: number }>();
  for (const t of surface.entries()) {
    pixels.set(
      tileKey(t.tx, t.ty),
      t.asset.canvas!.getContext('2d')!.getImageData(0, 0, TILE_SIZE, TILE_SIZE)
        .data,
    );
    const r = tileRect(t.tx, t.ty);
    for (const c of tileCoordinates({ ...r, w: r.w + 1, h: r.h + 1 }))
      candidates.set(tileKey(c.tx, c.ty), c);
  }
  const sample = (gx: number, gy: number) => {
    const x = gx - 1,
      y = gy - 1,
      tx = Math.floor(x / TILE_SIZE),
      ty = Math.floor(y / TILE_SIZE),
      p = pixels.get(tileKey(tx, ty));
    return (
      p?.[((y - ty * TILE_SIZE) * TILE_SIZE + x - tx * TILE_SIZE) * 4 + 3] ?? 0
    );
  };
  function* cells() {
    for (const { tx, ty } of candidates.values())
      for (let y = ty * TILE_SIZE; y < (ty + 1) * TILE_SIZE; y++)
        for (let x = tx * TILE_SIZE; x < (tx + 1) * TILE_SIZE; x++)
          yield { x, y };
  }
  return traceContours(sample, cells(), limit);
}

function traceContours(
  sample: (x: number, y: number) => number,
  cells: Iterable<{ x: number; y: number }>,
  limit: number,
): Array<Array<{ x: number; y: number }>> {
  const iso = Math.max(0.5, limit);
  const nodes = new Map<string, ContourNode>();
  const segments: ContourSegment[] = [];
  const addSegment = (
    a: { key: string; point: { x: number; y: number } },
    b: { key: string; point: { x: number; y: number } },
  ) => {
    if (a.key === b.key) return;
    const id = segments.length;
    segments.push({ a: a.key, b: b.key });
    for (const endpoint of [a, b]) {
      const node = nodes.get(endpoint.key);
      if (node) node.segmentIds.push(id);
      else nodes.set(endpoint.key, { point: endpoint.point, segmentIds: [id] });
    }
  };
  for (const { x: gridX, y: gridY } of cells) {
    const values = [
      sample(gridX, gridY),
      sample(gridX + 1, gridY),
      sample(gridX + 1, gridY + 1),
      sample(gridX, gridY + 1),
    ];
    const code = values.reduce(
      (result, value, index) => result | (value >= iso ? 1 << index : 0),
      0,
    );
    if (code === 0 || code === 15) continue;
    const crossing = (edge: number) => {
      const endpoints =
        edge === 0
          ? [0, 1]
          : edge === 1
            ? [1, 2]
            : edge === 2
              ? [3, 2]
              : [0, 3];
      const from = values[endpoints[0]],
        to = values[endpoints[1]];
      const t = Math.max(
        0,
        Math.min(
          1,
          Math.abs(to - from) < 1e-8 ? 0.5 : (iso - from) / (to - from),
        ),
      );
      if (edge === 0)
        return {
          key: `h:${gridX}:${gridY}`,
          point: { x: gridX - 0.5 + t, y: gridY - 0.5 },
        };
      if (edge === 1)
        return {
          key: `v:${gridX + 1}:${gridY}`,
          point: { x: gridX + 0.5, y: gridY - 0.5 + t },
        };
      if (edge === 2)
        return {
          key: `h:${gridX}:${gridY + 1}`,
          point: { x: gridX - 0.5 + t, y: gridY + 0.5 },
        };
      return {
        key: `v:${gridX}:${gridY}`,
        point: { x: gridX - 0.5, y: gridY - 0.5 + t },
      };
    };
    let pairs: Array<[number, number]>;
    if (code === 1 || code === 14) pairs = [[3, 0]];
    else if (code === 2 || code === 13) pairs = [[0, 1]];
    else if (code === 3 || code === 12) pairs = [[3, 1]];
    else if (code === 4 || code === 11) pairs = [[1, 2]];
    else if (code === 6 || code === 9) pairs = [[0, 2]];
    else if (code === 7 || code === 8) pairs = [[3, 2]];
    else {
      const centerInside =
        values.reduce((sum, value) => sum + value, 0) / 4 >= iso;
      pairs =
        code === 5
          ? centerInside
            ? [
                [0, 1],
                [2, 3],
              ]
            : [
                [3, 0],
                [1, 2],
              ]
          : centerInside
            ? [
                [3, 0],
                [1, 2],
              ]
            : [
                [0, 1],
                [2, 3],
              ];
    }
    for (const [a, b] of pairs) addSegment(crossing(a), crossing(b));
  }
  const used = new Uint8Array(segments.length);
  const contours: Array<Array<{ x: number; y: number }>> = [];
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex++) {
    if (used[firstIndex]) continue;
    const first = segments[firstIndex];
    const startKey = first.a;
    let currentKey = first.b;
    const raw = [nodes.get(startKey)!.point];
    used[firstIndex] = 1;
    while (currentKey !== startKey) {
      const node = nodes.get(currentKey);
      if (!node) break;
      raw.push(node.point);
      const next = node.segmentIds.find((id) => !used[id]);
      if (next === undefined) break;
      used[next] = 1;
      const segment = segments[next];
      currentKey = segment.a === currentKey ? segment.b : segment.a;
    }
    if (currentKey !== startKey || raw.length < 3) continue;
    let split = 1;
    for (let candidate = 2; candidate < raw.length; candidate++) {
      if (
        Math.hypot(raw[candidate].x - raw[0].x, raw[candidate].y - raw[0].y) >
        Math.hypot(raw[split].x - raw[0].x, raw[split].y - raw[0].y)
      )
        split = candidate;
    }
    // One-pixel caps and stair steps are rasterization artifacts; removing them
    // recovers the original vector-like corner for a clean miter join.
    const firstHalf = simplifyOpenPath(raw.slice(0, split + 1), 0.8);
    const secondHalf = simplifyOpenPath([...raw.slice(split), raw[0]], 0.8);
    const candidate = sharpenRasterCaps([
      ...firstHalf.slice(0, -1),
      ...secondHalf.slice(0, -1),
    ]);
    contours.push(candidate.length >= 3 ? candidate : raw);
  }
  return contours;
}

function signedArea(points: Array<{ x: number; y: number }>): number {
  return (
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2
  );
}

/** Adds only true convex corner tips; smooth contour joins remain rounded. */
function drawSharpCornerExtensions(
  ctx: CanvasRenderingContext2D,
  contour: Array<{ x: number; y: number }>,
  radius: number,
): void {
  const orientation = Math.sign(signedArea(contour)) || 1;
  for (let index = 0; index < contour.length; index++) {
    const previous = contour[(index - 1 + contour.length) % contour.length];
    const point = contour[index];
    const next = contour[(index + 1) % contour.length];
    const inLength = Math.hypot(point.x - previous.x, point.y - previous.y);
    const outLength = Math.hypot(next.x - point.x, next.y - point.y);
    if (inLength < 1e-6 || outLength < 1e-6) continue;
    const incoming = {
      x: (point.x - previous.x) / inLength,
      y: (point.y - previous.y) / inLength,
    };
    const outgoing = {
      x: (next.x - point.x) / outLength,
      y: (next.y - point.y) / outLength,
    };
    const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
    if (cross * orientation <= 0) continue;
    const turn = Math.acos(
      Math.max(
        -1,
        Math.min(1, incoming.x * outgoing.x + incoming.y * outgoing.y),
      ),
    );
    if (turn < 0.35) continue;
    const outward = (direction: { x: number; y: number }) =>
      orientation > 0
        ? { x: direction.y, y: -direction.x }
        : { x: -direction.y, y: direction.x };
    const beforeNormal = outward(incoming),
      afterNormal = outward(outgoing);
    const before = {
      x: point.x + beforeNormal.x * radius,
      y: point.y + beforeNormal.y * radius,
    };
    const after = {
      x: point.x + afterNormal.x * radius,
      y: point.y + afterNormal.y * radius,
    };
    const rawMiter = lineIntersection(
      before,
      { x: before.x + incoming.x, y: before.y + incoming.y },
      after,
      { x: after.x + outgoing.x, y: after.y + outgoing.y },
    );
    if (!rawMiter) continue;
    const dx = rawMiter.x - point.x,
      dy = rawMiter.y - point.y;
    const length = Math.hypot(dx, dy);
    const maximum = radius * SHARP_OUTLINE_MITER_LIMIT;
    const miter =
      length > maximum
        ? {
            x: point.x + (dx / length) * maximum,
            y: point.y + (dy / length) * maximum,
          }
        : rawMiter;
    ctx.beginPath();
    ctx.moveTo(before.x, before.y);
    ctx.lineTo(miter.x, miter.y);
    ctx.lineTo(after.x, after.y);
    ctx.closePath();
    ctx.fill();
  }
}

function buildOutlineDistanceField(
  scope: EffectScope,
  threshold: number,
  cornerStyle: 'round' | 'sharp',
  env: LayerDrawEnv,
): OutlineDistanceField | null {
  const width = scope.width,
    height = scope.height;
  const readback = env.borrowReadbackCanvas(width, height);
  readback.ctx.drawImage(
    scope.canvas,
    0,
    0,
    width,
    height,
    0,
    0,
    width,
    height,
  );
  env.stats.cpuReadbackPixels += width * height;
  const pixels = readback.ctx.getImageData(0, 0, width, height).data;
  const limit = clampUnit(threshold) * 255;
  let seedMinX = width,
    seedMinY = height,
    seedMaxX = -1,
    seedMaxY = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha === 0 || alpha < limit) continue;
      seedMinX = Math.min(seedMinX, x);
      seedMinY = Math.min(seedMinY, y);
      seedMaxX = Math.max(seedMaxX, x);
      seedMaxY = Math.max(seedMaxY, y);
    }
  if (seedMaxX < seedMinX || seedMaxY < seedMinY) {
    readback.release();
    return null;
  }

  // 太さスライダーでは距離変換をやり直さないよう、許容最大幅まで保持する。
  const maxPad = Math.ceil(mmToPx(SIZE_MM_MAX, env.ppi) + 1);
  const x0 = Math.max(0, seedMinX - maxPad),
    y0 = Math.max(0, seedMinY - maxPad);
  const x1 = Math.min(width - 1, seedMaxX + maxPad),
    y1 = Math.min(height - 1, seedMaxY + maxPad);
  const boxW = x1 - x0 + 1,
    boxH = y1 - y0 + 1;
  let squared: Float32Array | null = null;
  if (cornerStyle !== 'sharp') {
    const infinity = 1e20;
    squared = new Float32Array(boxW * boxH);
    for (let y = 0; y < boxH; y++)
      for (let x = 0; x < boxW; x++) {
        const alpha = pixels[((y + y0) * width + x + x0) * 4 + 3];
        squared[y * boxW + x] = alpha > 0 && alpha >= limit ? 0 : infinity;
      }
    const lineLength = Math.max(boxW, boxH);
    const inputLine = new Float64Array(lineLength);
    const outputLine = new Float64Array(lineLength);
    const sites = new Int32Array(lineLength);
    const bounds = new Float64Array(lineLength + 1);
    for (let y = 0; y < boxH; y++) {
      inputLine.set(squared.subarray(y * boxW, (y + 1) * boxW), 0);
      distanceTransform1d(inputLine, outputLine, boxW, sites, bounds);
      squared.set(outputLine.subarray(0, boxW), y * boxW);
    }
    for (let x = 0; x < boxW; x++) {
      for (let y = 0; y < boxH; y++) inputLine[y] = squared[y * boxW + x];
      distanceTransform1d(inputLine, outputLine, boxH, sites, bounds);
      for (let y = 0; y < boxH; y++) squared[y * boxW + x] = outputLine[y];
    }
  }
  const contours =
    cornerStyle === 'sharp'
      ? traceAlphaContours(pixels, width, height, limit)
      : [];
  readback.release();
  return {
    x: x0,
    y: y0,
    width: boxW,
    height: boxH,
    seedMinX,
    seedMinY,
    seedMaxX,
    seedMaxY,
    squared,
    contours,
  };
}

/** Draws the dilated binary silhouette below the untouched source. */
export function applyOutline(
  scope: EffectScope,
  cacheId: string,
  color: string,
  widthMm: number,
  threshold: number,
  cornerStyle: 'round' | 'sharp',
  opacity: number,
  env: LayerDrawEnv,
): void {
  const width = scope.width,
    height = scope.height;
  const radius = Math.max(0, mmToPx(widthMm, env.ppi));
  if (radius <= 0 || opacity <= 0) return;
  if (cornerStyle === 'sharp' && env.sharpContours) {
    const contours = env.sharpContours(cacheId, threshold, scope.inputRevision);
    const target = scope.canvas.getContext('2d')!;
    target.save();
    try {
      target.setTransform(1, 0, 0, 1, -scope.x, -scope.y);
      target.globalAlpha = clampUnit(opacity);
      target.globalCompositeOperation = 'destination-over';
      target.strokeStyle = color;
      target.fillStyle = color;
      target.lineWidth = radius * 2;
      target.lineCap = 'round';
      target.lineJoin = 'round';
      for (const contour of contours) {
        // Cache world bounds; never spread a potentially million-point contour as arguments.
        let bounds = contourBoundsCache.get(contour);
        if (!bounds) {
          let x = Infinity,
            y = Infinity,
            right = -Infinity,
            bottom = -Infinity;
          for (const p of contour) {
            x = Math.min(x, p.x);
            y = Math.min(y, p.y);
            right = Math.max(right, p.x);
            bottom = Math.max(bottom, p.y);
          }
          bounds = { x, y, w: right - x, h: bottom - y };
          contourBoundsCache.set(contour, bounds);
        }
        const margin = radius * SHARP_OUTLINE_MITER_LIMIT;
        if (
          bounds.x + bounds.w < scope.x - margin ||
          bounds.y + bounds.h < scope.y - margin ||
          bounds.x > scope.x + scope.width + margin ||
          bounds.y > scope.y + scope.height + margin
        )
          continue;
        target.beginPath();
        target.moveTo(contour[0].x, contour[0].y);
        for (let i = 1; i < contour.length; i++)
          target.lineTo(contour[i].x, contour[i].y);
        target.closePath();
        target.stroke();
        drawSharpCornerExtensions(target, contour, radius);
      }
    } finally {
      target.restore();
    }
    return;
  }
  const key = [
    'outline-distance',
    OUTLINE_CACHE_VERSION,
    cacheId,
    scope.inputRevision,
    scope.x,
    scope.y,
    width,
    height,
    clampUnit(threshold),
    cornerStyle,
    env.ppi,
  ].join('|');
  let field = env.effectCache.get<OutlineDistanceField | null>(key);
  if (field === undefined) {
    field = buildOutlineDistanceField(scope, threshold, cornerStyle, env);
    const contourBytes =
      field?.contours.reduce((sum, contour) => sum + contour.length * 16, 0) ??
      0;
    env.effectCache.set(
      key,
      field,
      Math.max(1, (field?.squared?.byteLength ?? 0) + contourBytes),
    );
  }
  if (!field) return;
  const target = scope.canvas.getContext('2d')!;
  if (cornerStyle === 'sharp') {
    if (!field.contours.length) return;
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = Math.max(0, Math.min(1, opacity));
    target.globalCompositeOperation = 'destination-over';
    target.strokeStyle = color;
    target.fillStyle = color;
    target.lineWidth = radius * 2;
    target.lineCap = 'round';
    target.lineJoin = 'round';
    for (const contour of field.contours) {
      target.beginPath();
      target.moveTo(contour[0].x, contour[0].y);
      for (let index = 1; index < contour.length; index++)
        target.lineTo(contour[index].x, contour[index].y);
      target.closePath();
      target.stroke();
      drawSharpCornerExtensions(target, contour, radius);
    }
    target.restore();
    return;
  }
  const squared = field.squared;
  if (!squared) return;
  const pad = Math.ceil(radius + 1);
  const minX = Math.max(field.x, field.seedMinX - pad);
  const minY = Math.max(field.y, field.seedMinY - pad);
  const maxX = Math.min(field.x + field.width - 1, field.seedMaxX + pad);
  const maxY = Math.min(field.y + field.height - 1, field.seedMaxY + pad);
  const boxW = maxX - minX + 1,
    boxH = maxY - minY + 1;
  const outline = env.borrowCanvas(boxW, boxH);
  const image = outline.ctx.createImageData(boxW, boxH);
  const [red, green, blue] = parseHex(color);
  const maxDistance = radius + 0.5;
  const innerDistance = Math.max(0, radius - 0.5);
  for (let x = 0; x < boxW; x++) {
    for (let y = 0; y < boxH; y++) {
      const fieldX = minX + x - field.x;
      const fieldY = minY + y - field.y;
      const stored = squared[fieldY * field.width + fieldX];
      const distance = Math.sqrt(stored);
      const coverage =
        distance <= innerDistance
          ? 1
          : distance <= maxDistance
            ? Math.max(0, Math.min(1, maxDistance - distance))
            : 0;
      if (!coverage) continue;
      const offset = (y * boxW + x) * 4;
      image.data[offset] = red;
      image.data[offset + 1] = green;
      image.data[offset + 2] = blue;
      image.data[offset + 3] = Math.round(
        255 * coverage * Math.max(0, Math.min(1, opacity)),
      );
    }
  }
  outline.ctx.putImageData(image, 0, 0);
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.globalAlpha = 1;
  target.globalCompositeOperation = 'destination-over';
  target.drawImage(outline.canvas, minX, minY);
  target.restore();
  outline.release();
}
