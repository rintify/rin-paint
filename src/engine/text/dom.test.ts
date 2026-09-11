// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { newText, formatRange, setRuby } from './model';
import { populateText } from './render';
import { editorSelection, plainEditorText, restoreEditorSelection } from './session';

describe('shared text DOM and selection', () => {
  it('keeps ruby readings out of source text and DOM selection offsets', () => {
    const text = setRuby({ ...newText(0, 0, '#000000'), content: '東京へ\n😀' }, 0, 2, 'とうきょう');
    const root = document.createElement('div');
    document.body.append(root);
    populateText(root, text, 300);
    expect(root.querySelector('rt')?.textContent).toBe('とうきょう');
    expect(plainEditorText(root)).toBe(text.content);
    restoreEditorSelection(root, 1, 3);
    expect(editorSelection(root)).toEqual({ start: 1, end: 3 });
    root.remove();
  });
  it('uses the same point-to-pixel conversion for mixed styles in vertical writing', () => {
    let text = { ...newText(0, 0, '#123456', 300, 500), content: '文字', direction: 'vertical' as const };
    text = formatRange(text, 1, 2, { sizePt: 24, fontId: 'serif' }) as typeof text;
    const root = document.createElement('div');
    populateText(root, text, 300);
    expect(root.style.writingMode).toBe('vertical-rl');
    expect(root.style.width).toBe('300px');
    expect(root.style.height).toBe('500px');
    expect([...root.querySelectorAll('span')].map(el => el.style.fontSize)).toEqual(['50px', '100px']);
  });
  it('does not turn a trailing caret placeholder into another newline', () => {
    const root = document.createElement('div');
    populateText(root, { ...newText(0, 0, '#000000'), content: '終わり\n' }, 300);
    expect(plainEditorText(root)).toBe('終わり\n');
  });
});
