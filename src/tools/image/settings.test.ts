import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_TOOL_SETTINGS, imageToolBoxPx, normalizeImageToolSettings } from './settings';

describe('normalizeImageToolSettings', () => {
  it('falls back to defaults and clamps invalid values', () => {
    expect(normalizeImageToolSettings(undefined)).toEqual(DEFAULT_IMAGE_TOOL_SETTINGS);
    expect(normalizeImageToolSettings({ widthMm: 0, heightMm: 2000 })).toEqual({ widthMm: 0.01, heightMm: 1000 });
    expect(normalizeImageToolSettings({ widthMm: 12.345, heightMm: 8 })).toEqual({ widthMm: 12.35, heightMm: 8 });
  });

  it('converts the placement box to pixels at the page ppi', () => {
    expect(imageToolBoxPx({ widthMm: 25.4, heightMm: 12.7 }, 300)).toEqual({ width: 300, height: 150 });
  });
});
