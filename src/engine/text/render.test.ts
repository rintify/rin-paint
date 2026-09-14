// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toCanvas } from 'html-to-image';
import { TextRenderer } from './render';
import { newText } from './model';
import { builtInFontCss, fontFamily, GEN_EI_ANTIQUE_FONT_ID, STANDARD_FONTS } from './fonts';

vi.mock('html-to-image', () => ({
  toCanvas: vi.fn(async () => document.createElement('canvas')),
}));

describe('text bitmap reuse', () => {
  beforeEach(() => {
    vi.mocked(toCanvas).mockClear();
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: vi.fn(async () => []) } });
  });

  it('reuses the bitmap throughout movement and rotation, but rerenders changed content', async () => {
    const renderer = new TextRenderer();
    const text = { ...newText(0, 0, '#000'), content: '文字' };
    renderer.request('text', text, 72, () => {});
    await renderer.ready();
    const bitmap = renderer.get('text');
    expect(bitmap).not.toBeNull();
    for (let i = 0; i < 100; i++) {
      renderer.request('text', { ...text, x: i, y: i * 2, rotation: i / 10 }, 72, () => {});
    }
    await renderer.ready();
    expect(toCanvas).toHaveBeenCalledTimes(1);
    expect(renderer.get('text')).toBe(bitmap);
    renderer.request('text', { ...text, content: '変更' }, 72, () => {});
    await renderer.ready();
    expect(toCanvas).toHaveBeenCalledTimes(2);
  });

  it('does not embed the bundled font in text using a system font', async () => {
    const renderer = new TextRenderer();
    const text = newText(0, 0, '#000');
    text.style.fontId = 'serif';
    renderer.request('text', text, 72, () => {});
    await renderer.ready();
    expect(vi.mocked(toCanvas).mock.calls[0][1]?.fontEmbedCSS).toBe('');
  });
});

describe('built-in fonts', () => {
  it('exposes GenEi Antique and stable generic fallbacks', () => {
    expect(STANDARD_FONTS.map(font => font.id)).toEqual([
      GEN_EI_ANTIQUE_FONT_ID,
      'sans',
      'serif',
      'mono',
    ]);
    expect(fontFamily(GEN_EI_ANTIQUE_FONT_ID)).toContain('rin-builtin-genei-antique-v6');
    expect(fontFamily(GEN_EI_ANTIQUE_FONT_ID)).toContain('sans-serif');
  });

  it('normalizes CSS generic family aliases instead of treating them as missing project fonts', () => {
    expect(fontFamily('sans-serif')).toBe(fontFamily('sans'));
    expect(fontFamily('monospace')).toBe(fontFamily('mono'));
    expect(fontFamily('serif')).toContain('serif');
  });

  it('can replace the live asset URL with embedded font data for bitmap rendering', () => {
    const css = builtInFontCss(() => 'data:font/ttf;base64,dGVzdA==');
    expect(css).toContain('url("data:font/ttf;base64,dGVzdA==")');
    expect(css).not.toContain('/src/assets/fonts');
  });
});
