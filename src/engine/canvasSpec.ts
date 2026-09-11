import { MAX_ART_SIZE, MIN_ART_SIZE, type CanvasSpec, type ShapeParams } from '../types';

export function canvasPixels(spec: CanvasSpec): { width: number; height: number } {
  return { width: Math.round(spec.widthMm * spec.ppi / 25.4), height: Math.round(spec.heightMm * spec.ppi / 25.4) };
}
export function validateCanvasSpec(spec: CanvasSpec): string | null {
  if (![spec.widthMm, spec.heightMm, spec.ppi].every(v => Number.isFinite(v) && v > 0)) return '幅・高さ・ppiに正の数を入力してください';
  const { width, height } = canvasPixels(spec);
  return width < MIN_ART_SIZE || height < MIN_ART_SIZE || width > MAX_ART_SIZE || height > MAX_ART_SIZE
    ? `各辺が${MIN_ART_SIZE}〜${MAX_ART_SIZE}pxになるサイズ・ppiを指定してください` : null;
}
export function scaleShape(shape: ShapeParams, factor: number): ShapeParams {
  switch (shape.kind) {
    case 'line': return { ...shape, x1: shape.x1 * factor, y1: shape.y1 * factor, x2: shape.x2 * factor, y2: shape.y2 * factor, width: shape.width * factor };
    case 'rect': return { ...shape, x: shape.x * factor, y: shape.y * factor, width: shape.width * factor, height: shape.height * factor, strokeWidth: shape.strokeWidth * factor };
    case 'ellipse': return { ...shape, cx: shape.cx * factor, cy: shape.cy * factor, rx: shape.rx * factor, ry: shape.ry * factor, strokeWidth: shape.strokeWidth * factor };
  }
}

/** PNG pHYs (pixels/metre). Replace the browser's default 96dpi chunk. */
export async function pngWithPpi(blob: Blob, ppi: number): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4);
  view.setUint32(8, Math.round(ppi / 0.0254));
  view.setUint32(12, Math.round(ppi / 0.0254));
  chunk[16] = 1;
  let crc = 0xffffffff;
  for (const b of chunk.slice(4, 17)) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(17, (crc ^ 0xffffffff) >>> 0);
  const parts: BlobPart[] = [bytes.slice(0, 8)];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type !== 'pHYs') parts.push(bytes.slice(offset, offset + length + 12));
    if (type === 'IHDR') parts.push(chunk);
    offset += length + 12;
  }
  return new Blob(parts, { type: 'image/png' });
}
