import { mmToPx } from '../units';
import type { CanvasLease, EffectScope, LayerDrawEnv } from './types';

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

/** Straight-alpha interpolation is intentional: both adjustment inputs have the same shape. */
export function mixCanvases(
  target: HTMLCanvasElement,
  original: HTMLCanvasElement,
  effected: HTMLCanvasElement,
  strength: number,
  mask: HTMLCanvasElement | null,
): void {
  const width = target.width, height = target.height;
  const originalData = original.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height);
  const effectedData = effected.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height);
  const maskData = mask?.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height).data;
  const a = originalData.data, b = effectedData.data;
  const opacity = Math.max(0, Math.min(1, strength));
  for (let offset = 0; offset < a.length; offset += 4) {
    const weight = opacity * (maskData ? maskData[offset + 3] / 255 : 1);
    if (weight <= 0) continue;
    a[offset] = Math.round(a[offset] + (b[offset] - a[offset]) * weight);
    a[offset + 1] = Math.round(a[offset + 1] + (b[offset + 1] - a[offset + 1]) * weight);
    a[offset + 2] = Math.round(a[offset + 2] + (b[offset + 2] - a[offset + 2]) * weight);
    a[offset + 3] = Math.round(a[offset + 3] + (b[offset + 3] - a[offset + 3]) * weight);
  }
  target.getContext('2d')!.putImageData(originalData, 0, 0);
}

export function applyClip(scope: EffectScope, mask: HTMLCanvasElement, opacity: number): void {
  const ctx = scope.canvas.getContext('2d', { willReadFrequently: true })!;
  const source = ctx.getImageData(0, 0, scope.canvas.width, scope.canvas.height);
  const maskData = mask.getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, scope.canvas.width, scope.canvas.height).data;
  const strength = Math.max(0, Math.min(1, opacity));
  for (let offset = 0; offset < source.data.length; offset += 4) {
    const factor = 1 - strength * (1 - maskData[offset + 3] / 255);
    source.data[offset + 3] = Math.round(source.data[offset + 3] * factor);
  }
  ctx.putImageData(source, 0, 0);
}

function distanceTransform1d(input: Float64Array, output: Float64Array, length: number): void {
  const sites = new Int32Array(length);
  const bounds = new Float64Array(length + 1);
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

/** Draws the dilated binary silhouette below the untouched source. */
export function applyOutline(
  scope: EffectScope,
  color: string,
  widthMm: number,
  threshold: number,
  opacity: number,
  env: LayerDrawEnv,
): void {
  const width = scope.canvas.width, height = scope.canvas.height;
  const radius = Math.max(0, mmToPx(widthMm, env.ppi));
  if (radius <= 0 || opacity <= 0) return;
  const original = copyCanvas(env, scope.canvas);
  const pixels = original.ctx.getImageData(0, 0, width, height).data;
  const limit = Math.max(0, Math.min(1, threshold)) * 255;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = pixels[(y * width + x) * 4 + 3];
    if (alpha === 0 || alpha < limit) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (maxX < minX || maxY < minY) { original.release(); return; }
  const pad = Math.ceil(radius + 1);
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const boxW = maxX - minX + 1, boxH = maxY - minY + 1;
  const infinity = 1e20;
  const first = new Float32Array(boxW * boxH);
  for (let y = 0; y < boxH; y++) for (let x = 0; x < boxW; x++) {
    const alpha = pixels[((y + minY) * width + x + minX) * 4 + 3];
    first[y * boxW + x] = alpha > 0 && alpha >= limit ? 0 : infinity;
  }
  const inputLine = new Float64Array(Math.max(boxW, boxH));
  const outputLine = new Float64Array(inputLine.length);
  for (let y = 0; y < boxH; y++) {
    inputLine.set(first.subarray(y * boxW, (y + 1) * boxW), 0);
    distanceTransform1d(inputLine, outputLine, boxW);
    first.set(outputLine.subarray(0, boxW), y * boxW);
  }
  const outline = env.borrowCanvas();
  const image = outline.ctx.createImageData(boxW, boxH);
  const [red, green, blue] = parseHex(color);
  const maxDistance = radius + 0.5;
  for (let x = 0; x < boxW; x++) {
    for (let y = 0; y < boxH; y++) inputLine[y] = first[y * boxW + x];
    distanceTransform1d(inputLine, outputLine, boxH);
    for (let y = 0; y < boxH; y++) {
      const coverage = Math.max(0, Math.min(1, maxDistance - Math.sqrt(outputLine[y])));
      if (!coverage) continue;
      const offset = (y * boxW + x) * 4;
      image.data[offset] = red; image.data[offset + 1] = green; image.data[offset + 2] = blue;
      image.data[offset + 3] = Math.round(255 * coverage * Math.max(0, Math.min(1, opacity)));
    }
  }
  outline.ctx.putImageData(image, minX, minY);
  const target = scope.canvas.getContext('2d')!;
  clear(target, width, height);
  target.drawImage(outline.canvas, 0, 0);
  target.drawImage(original.canvas, 0, 0);
  outline.release();
  original.release();
}
