import { describe, expect, it } from 'vitest';
import { liftListOriginIfTooLow, shouldPreserveRowAnchor } from './hierarchyListLayout';

describe('shouldPreserveRowAnchor', () => {
  it('lets a row in the lower half naturally move upward', () => {
    expect(shouldPreserveRowAnchor(240, 144, 400)).toBe(false);
    expect(shouldPreserveRowAnchor(200, 199, 400)).toBe(false);
  });

  it('preserves a row in the upper half or one that would move downward', () => {
    expect(shouldPreserveRowAnchor(199, 100, 400)).toBe(true);
    expect(shouldPreserveRowAnchor(240, 288, 400)).toBe(true);
    expect(shouldPreserveRowAnchor(240, 240, 400)).toBe(true);
  });
});

describe('liftListOriginIfTooLow', () => {
  it('leaves the origin alone when the first row is above 30%', () => {
    expect(liftListOriginIfTooLow(80, 0, 400)).toEqual({ top: 80, scroll: 0 });
    expect(liftListOriginIfTooLow(200, 100, 400)).toEqual({ top: 200, scroll: 100 });
  });

  it('pulls the first row to the top when it sits at or below 30%', () => {
    expect(liftListOriginIfTooLow(120, 0, 400)).toEqual({ top: 0, scroll: 0 });
    expect(liftListOriginIfTooLow(250, 0, 400)).toEqual({ top: 0, scroll: 0 });
    expect(liftListOriginIfTooLow(280, 40, 400)).toEqual({ top: 40, scroll: 40 });
  });
});
