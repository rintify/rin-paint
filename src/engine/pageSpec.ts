import { MAX_PAGE_PIXEL_SIZE, MIN_PAGE_PIXEL_SIZE, type PageSpec, type ShapeParams } from '../types';
import { scaleShapeBy } from './shapes';

export function pagePixels(spec: PageSpec): { width: number; height: number } {
  return { width: Math.round(spec.widthMm * spec.ppi / 25.4), height: Math.round(spec.heightMm * spec.ppi / 25.4) };
}
export function validatePageSpec(spec: PageSpec): string | null {
  if (![spec.widthMm, spec.heightMm, spec.ppi].every(v => Number.isFinite(v) && v > 0)) return '幅・高さ・ppiに正の数を入力してください';
  const { width, height } = pagePixels(spec);
  return width < MIN_PAGE_PIXEL_SIZE || height < MIN_PAGE_PIXEL_SIZE || width > MAX_PAGE_PIXEL_SIZE || height > MAX_PAGE_PIXEL_SIZE
    ? `各辺が${MIN_PAGE_PIXEL_SIZE}〜${MAX_PAGE_PIXEL_SIZE}pxになるサイズ・ppiを指定してください` : null;
}
export function scaleShape(shape: ShapeParams, factor: number): ShapeParams {
  return scaleShapeBy(shape, factor);
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
