import { describe, expect, it } from 'vitest';
import { pagePixels, pngWithPpi, scaleShape, validatePageSpec } from './pageSpec';
import { createCanvas } from '@napi-rs/canvas';

describe('physical page dimensions', () => {
  it('converts mm and ppi with one final rounding step', () => {
    expect(pagePixels({ widthMm: 210, heightMm: 297, ppi: 300 })).toEqual({ width: 2480, height: 3508 });
    expect(validatePageSpec({ widthMm: 210, heightMm: 297, ppi: 600 })).not.toBeNull();
    expect(validatePageSpec({ widthMm: 210, heightMm: 297, ppi: 0 })).not.toBeNull();
  });
  it('scales both shape coordinates and stroke widths for ppi changes', () => {
    expect(scaleShape({ kind: 'line', x1: 2, y1: 3, x2: 20, y2: 30, strokeWidth: 4, color: '#000' }, 2)).toEqual({ kind: 'line', x1: 4, y1: 6, x2: 40, y2: 60, strokeWidth: 8, color: '#000' });
  });
  it('writes one pHYs chunk containing the requested resolution', async () => {
    const blob = new Blob([new Uint8Array(await createCanvas(4, 4).encode('png'))]);
    const result = new Uint8Array(await (await pngWithPpi(await pngWithPpi(blob, 72), 300)).arrayBuffer());
    const found: number[] = [];
    for (let offset = 8; offset + 12 <= result.length;) {
      const view = new DataView(result.buffer, offset);
      const type = String.fromCharCode(...result.slice(offset + 4, offset + 8));
      if (type === 'pHYs') { found.push(view.getUint32(8)); expect(view.getUint32(12)).toBe(11811); expect(result[offset + 16]).toBe(1); }
      offset += view.getUint32(0) + 12;
    }
    expect(found).toEqual([11811]);
  });
});
