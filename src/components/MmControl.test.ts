import { describe, expect, it } from 'vitest';
import { exponentialMmPosition, exponentialMmValue } from './MmControl';

describe('exponential mm slider scale', () => {
  it('keeps endpoints and gives small widths more slider travel', () => {
    expect(exponentialMmValue(0, 0.01, 20)).toBeCloseTo(0.01);
    expect(exponentialMmValue(1, 0.01, 20)).toBeCloseTo(20);
    expect(exponentialMmValue(0.5, 0.01, 20)).toBeCloseTo(Math.sqrt(0.2));
  });

  it('round-trips values and supports a true zero endpoint', () => {
    for (const value of [0.01, 0.1, 1, 10, 20]) {
      expect(exponentialMmValue(exponentialMmPosition(value, 0.01, 20), 0.01, 20)).toBeCloseTo(value);
    }
    expect(exponentialMmValue(0, 0, 20)).toBe(0);
  });
});
