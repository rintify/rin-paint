import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIZE_MM,
  formatMm,
  gapCloseMmToPx,
  mmToPx,
  pxToMm,
  roundMm,
} from './units';

describe('mm / px conversion', () => {
  it.each([72, 300, 600] as const)('round-trips at %i ppi without display rounding', (ppi) => {
    const mm = 1.19;
    const px = mmToPx(mm, ppi);
    expect(pxToMm(px, ppi)).toBeCloseTo(mm, 12);
  });

  it('maps default size to ~14px at 300ppi', () => {
    expect(mmToPx(DEFAULT_SIZE_MM, 300)).toBeCloseTo(14.05511811023622, 10);
    expect(roundMm(pxToMm(14, 300))).toBe(1.19);
  });

  it('formats mm to two decimal places', () => {
    expect(formatMm(1.185)).toBe('1.19');
    expect(formatMm(1.184)).toBe('1.18');
    expect(formatMm(0.01)).toBe('0.01');
  });

  it('converts gap-close mm to integer px with a 1px floor', () => {
    expect(gapCloseMmToPx(0, 300)).toBe(0);
    expect(gapCloseMmToPx(0.001, 300)).toBe(1);
    expect(gapCloseMmToPx(10, 300)).toBe(Math.round(mmToPx(10, 300)));
    expect(gapCloseMmToPx(10, 72)).toBe(Math.round(mmToPx(10, 72)));
    expect(gapCloseMmToPx(10, 600)).toBe(Math.round(mmToPx(10, 600)));
  });
});
