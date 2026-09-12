import { describe, expect, it } from 'vitest';
import { normalizeEyedropperToolSettings } from './settings';

describe('normalizeEyedropperToolSettings', () => {
  it('defaults invalid settings to the active layer', () => {
    expect(normalizeEyedropperToolSettings(undefined)).toEqual({ source: 'active-layer' });
    expect(normalizeEyedropperToolSettings({ source: 'unknown' })).toEqual({ source: 'active-layer' });
  });

  it('accepts the final rendered color source', () => {
    expect(normalizeEyedropperToolSettings({ source: 'final-color' })).toEqual({ source: 'final-color' });
  });
});
