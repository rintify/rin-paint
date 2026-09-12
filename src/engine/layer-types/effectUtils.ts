import { mmToPx, SIZE_MM_MAX } from '../units';
import type { CanvasLease, EffectScope, LayerDrawEnv, MaskCanvas } from './types';

function clear(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, width, height);
  ctx.restore();
}

export function copyCanvas(env: LayerDrawEnv, source: HTMLCanvasElement): CanvasLease {
  const lease = env.borrowCanvas();
  lease.ctx.drawImage(source, 0, 0);
  return lease;
}

export function replaceCanvas(target: HTMLCanvasElement, source: CanvasImageSource): void {
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
    scope.x, scope.y, scope.width, scope.height,
    0, 0, scope.width, scope.height,
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

export function applyClip(scope: EffectScope, mask: MaskCanvas, opacity: number, env: LayerDrawEnv): void {
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
    let split = ((input[q] + q * q) - (input[site] + site * site)) / (2 * (q - site));
    while (split <= bounds[k] && k > 0) {
      k--;
      site = sites[k];
      split = ((input[q] + q * q) - (input[site] + site * site)) / (2 * (q - site));
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
  squared: Float32Array;
}

function buildOutlineDistanceField(
  scope: EffectScope,
  threshold: number,
  env: LayerDrawEnv,
): OutlineDistanceField | null {
  const width = scope.width, height = scope.height;
  const readback = env.borrowReadbackCanvas(width, height);
  readback.ctx.drawImage(scope.canvas, 0, 0, width, height, 0, 0, width, height);
  env.stats.cpuReadbackPixels += width * height;
  const pixels = readback.ctx.getImageData(0, 0, width, height).data;
  const limit = clampUnit(threshold) * 255;
  let seedMinX = width, seedMinY = height, seedMaxX = -1, seedMaxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = pixels[(y * width + x) * 4 + 3];
    if (alpha === 0 || alpha < limit) continue;
    seedMinX = Math.min(seedMinX, x); seedMinY = Math.min(seedMinY, y);
    seedMaxX = Math.max(seedMaxX, x); seedMaxY = Math.max(seedMaxY, y);
  }
  if (seedMaxX < seedMinX || seedMaxY < seedMinY) {
    readback.release();
    return null;
  }

  // 太さスライダーでは距離変換をやり直さないよう、許容最大幅まで保持する。
  const maxPad = Math.ceil(mmToPx(SIZE_MM_MAX, env.ppi) + 1);
  const x0 = Math.max(0, seedMinX - maxPad), y0 = Math.max(0, seedMinY - maxPad);
  const x1 = Math.min(width - 1, seedMaxX + maxPad), y1 = Math.min(height - 1, seedMaxY + maxPad);
  const boxW = x1 - x0 + 1, boxH = y1 - y0 + 1;
  const infinity = 1e20;
  const squared = new Float32Array(boxW * boxH);
  for (let y = 0; y < boxH; y++) for (let x = 0; x < boxW; x++) {
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
  readback.release();
  return {
    x: x0, y: y0, width: boxW, height: boxH,
    seedMinX, seedMinY, seedMaxX, seedMaxY, squared,
  };
}

/** Draws the dilated binary silhouette below the untouched source. */
export function applyOutline(
  scope: EffectScope,
  cacheId: string,
  color: string,
  widthMm: number,
  threshold: number,
  opacity: number,
  env: LayerDrawEnv,
): void {
  const width = scope.width, height = scope.height;
  const radius = Math.max(0, mmToPx(widthMm, env.ppi));
  if (radius <= 0 || opacity <= 0) return;
  const key = [
    'outline-distance', cacheId, scope.inputRevision,
    scope.x, scope.y, width, height, clampUnit(threshold), env.ppi,
  ].join('|');
  let field = env.effectCache.get<OutlineDistanceField | null>(key);
  if (field === undefined) {
    field = buildOutlineDistanceField(scope, threshold, env);
    env.effectCache.set(key, field, field?.squared.byteLength ?? 1);
  }
  if (!field) return;
  const pad = Math.ceil(radius + 1);
  const minX = Math.max(field.x, field.seedMinX - pad);
  const minY = Math.max(field.y, field.seedMinY - pad);
  const maxX = Math.min(field.x + field.width - 1, field.seedMaxX + pad);
  const maxY = Math.min(field.y + field.height - 1, field.seedMaxY + pad);
  const boxW = maxX - minX + 1, boxH = maxY - minY + 1;
  const outline = env.borrowCanvas(boxW, boxH);
  const image = outline.ctx.createImageData(boxW, boxH);
  const [red, green, blue] = parseHex(color);
  const maxDistance = radius + 0.5;
  const innerDistance = Math.max(0, radius - 0.5);
  const innerSquared = innerDistance * innerDistance;
  const maxSquared = maxDistance * maxDistance;
  for (let x = 0; x < boxW; x++) {
    for (let y = 0; y < boxH; y++) {
      const fieldX = minX + x - field.x;
      const fieldY = minY + y - field.y;
      const squared = field.squared[fieldY * field.width + fieldX];
      const coverage = squared <= innerSquared
        ? 1
        : squared <= maxSquared
          ? Math.max(0, Math.min(1, maxDistance - Math.sqrt(squared)))
          : 0;
      if (!coverage) continue;
      const offset = (y * boxW + x) * 4;
      image.data[offset] = red; image.data[offset + 1] = green; image.data[offset + 2] = blue;
      image.data[offset + 3] = Math.round(255 * coverage * Math.max(0, Math.min(1, opacity)));
    }
  }
  outline.ctx.putImageData(image, 0, 0);
  const target = scope.canvas.getContext('2d')!;
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.globalAlpha = 1;
  target.globalCompositeOperation = 'destination-over';
  target.drawImage(outline.canvas, minX, minY);
  target.restore();
  outline.release();
}
