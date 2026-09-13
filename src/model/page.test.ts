import { describe, expect, it } from 'vitest';
import { matchingPaperTemplate, paperSizeDimensions, PAPER_SIZE_TEMPLATES } from './page';

describe('paper size templates', () => {
  it('matches portrait and landscape A4', () => {
    expect(matchingPaperTemplate(210, 297)?.id).toBe('a4');
    expect(matchingPaperTemplate(297, 210)?.id).toBe('a4');
  });

  it('does not match the default screen-like canvas', () => {
    expect(matchingPaperTemplate((1600 * 25.4) / 300, (1200 * 25.4) / 300)).toBeNull();
  });

  it('applies B5 as landscape when requested', () => {
    const b5 = PAPER_SIZE_TEMPLATES.find(item => item.id === 'b5')!;
    expect(paperSizeDimensions(b5, true)).toEqual({ widthMm: 257, heightMm: 182 });
  });
});
