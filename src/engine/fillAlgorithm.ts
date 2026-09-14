export interface FillAnalysisInput {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  seedX: number;
  seedY: number;
  tolerance: number;
  gapClosePx: number;
  progress?: (value: number) => void;
}

export interface FillAnalysisResult {
  mask: Uint8Array;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

function srgb(value: number): number {
  const v = value / 255;
  return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
}

function oklab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgb(r), lg = srgb(g), lb = srgb(b);
  const l = .4122214708 * lr + .5363325363 * lg + .0514459929 * lb;
  const m = .2119034982 * lr + .6806995451 * lg + .1073969566 * lb;
  const s = .0883024619 * lr + .2817188376 * lg + .6299787005 * lb;
  const l3 = Math.cbrt(l), m3 = Math.cbrt(m), s3 = Math.cbrt(s);
  return [
    .2104542553 * l3 + .793617785 * m3 - .0040720468 * s3,
    1.9779984951 * l3 - 2.428592205 * m3 + .4505937099 * s3,
    .0259040371 * l3 + .7827717662 * m3 - .808675766 * s3,
  ];
}

function closeBoundary(boundary: Uint8Array, width: number, height: number, gap: number): Uint8Array {
  if (gap <= 0) return boundary;
  const result = boundary.slice();
  const bridgeLine = (length: number, at: (offset: number) => number) => {
    let offset = 0;
    while (offset < length) {
      while (offset < length && boundary[at(offset)]) offset++;
      const start = offset;
      while (offset < length && !boundary[at(offset)]) offset++;
      const span = offset - start;
      if (start > 0 && offset < length && span > 0 && span <= gap) {
        for (let i = start; i < offset; i++) result[at(i)] = 1;
      }
    }
  };
  // Directional binary closing. Only runs bounded by real boundary pixels are
  // bridged, so an opening wider than the configured level remains open.
  for (let y = 0; y < height; y++) bridgeLine(width, x => y * width + x);
  for (let x = 0; x < width; x++) bridgeLine(height, y => y * width + x);
  return result;
}

export function analyzeFill(input: FillAnalysisInput): FillAnalysisResult {
  const { width, height, pixels } = input;
  const count = width * height;
  const sx = Math.max(0, Math.min(width - 1, Math.floor(input.seedX)));
  const sy = Math.max(0, Math.min(height - 1, Math.floor(input.seedY)));
  const seedIndex = (sy * width + sx) * 4;
  const seed = oklab(pixels[seedIndex], pixels[seedIndex + 1], pixels[seedIndex + 2]);
  const seedAlpha = pixels[seedIndex + 3] / 255;
  const threshold = Math.max(0, Math.min(100, input.tolerance));
  const boundary = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    const color = oklab(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    const alpha = pixels[offset + 3] / 255;
    const distance = Math.min(100, Math.hypot(color[0] * alpha - seed[0] * seedAlpha,
      color[1] * alpha - seed[1] * seedAlpha, color[2] * alpha - seed[2] * seedAlpha,
      alpha - seedAlpha) * 100);
    boundary[i] = Number(distance > threshold + 1e-7);
  }
  input.progress?.(.35);
  const closed = closeBoundary(boundary, width, height, Math.max(0, Math.min(Math.max(width, height), Math.round(input.gapClosePx))));
  input.progress?.(.62);
  const seedPixel = sy * width + sx;
  if (boundary[seedPixel] || closed[seedPixel]) return { mask: new Uint8Array(count), bounds: null };
  const mask = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0, tail = 0;
  queue[tail++] = seedPixel;
  mask[seedPixel] = 1;
  let minX = sx, maxX = sx, minY = sy, maxY = sy;
  while (head < tail) {
    const index = queue[head++];
    const x = index % width, y = (index / width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    const visit = (next: number) => {
      if (!mask[next] && !boundary[next] && !closed[next]) {
        mask[next] = 1;
        queue[tail++] = next;
      }
    };
    if (x > 0) visit(index - 1);
    if (x + 1 < width) visit(index + 1);
    if (y > 0) visit(index - width);
    if (y + 1 < height) visit(index + width);
  }
  input.progress?.(1);
  return { mask, bounds: tail ? { minX, minY, maxX: maxX + 1, maxY: maxY + 1 } : null };
}
