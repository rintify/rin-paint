import { describe, expect, it } from 'vitest';
import { formatRange, isEmptyText, newText, replaceText, resizeTextBox, setRuby, styleAt, textAlignment, textEditorFrameOrigin } from './model';

describe('rich text edits', () => {
  it('keeps partial formatting and ruby when inserting elsewhere', () => {
    let text = { ...newText(10, 20, '#123456'), content: '東京へ\n行こう' };
    text = formatRange(text, 0, 2, { sizeMm: 24, fontId: 'serif' });
    text = setRuby(text, 0, 2, 'とうきょう');
    const next = replaceText(text, '新東京へ\n行こう', text.style);
    expect(next.ruby).toEqual([{ start: 1, end: 3, text: 'とうきょう' }]);
    expect(styleAt(next, 1)).toMatchObject({ sizeMm: 24, fontId: 'serif' });
    expect(styleAt(next, 0)).toEqual(text.style);
  });
  it('removes only ruby whose base was changed', () => {
    let text = { ...newText(0, 0, '#000000'), content: '東京大阪' };
    text = setRuby(setRuby(text, 0, 2, 'とうきょう'), 2, 4, 'おおさか');
    const next = replaceText(text, '東都大阪', text.style);
    expect(next.ruby).toEqual([{ start: 2, end: 4, text: 'おおさか' }]);
  });
  it('preserves emoji boundaries, newlines, and unaffected run styles', () => {
    let text = { ...newText(0, 0, '#123456'), content: '😀文章\n終わり' };
    text = formatRange(text, 2, 4, { color: '#ff0000' });
    const next = replaceText(text, '😃文章\n終わり', text.style);
    expect(styleAt(next, 2).color).toBe('#ff0000');
    expect(next.content).toBe('😃文章\n終わり');
    expect(next.ranges.every(r => r.start !== 1 && r.end !== 1)).toBe(true);
  });
  it('changes future typing without restyling existing characters', () => {
    let text = { ...newText(0, 0, '#123456'), content: '既存' };
    text = formatRange(text, 0, 2, { color: '#ff0000' });
    const next = formatRange(text, 2, 2, { color: '#0000ff' });
    const inserted = replaceText(next, '既存追記', next.style);
    expect(styleAt(inserted, 0).color).toBe('#ff0000');
    expect(styleAt(inserted, 2).color).toBe('#0000ff');
  });
  it('rejects ruby crossing a newline and replaces overlapping annotations', () => {
    const text = { ...newText(0, 0, '#000000'), content: '東京\n大阪' };
    expect(setRuby(text, 0, 4, 'よみ')).toBe(text);
    expect(setRuby(setRuby(text, 0, 2, 'とうきょう'), 0, 1, 'ひがし').ruby).toEqual([{ start: 0, end: 1, text: 'ひがし' }]);
  });
  it('applies tool defaults and treats whitespace-only content as empty', () => {
    const text = newText(4, 8, '#abcdef', 120, 80, { fontId: 'serif', sizePt: 26, direction: 'vertical', horizontalAlign: 'right', verticalAlign: 'bottom', lineHeight: 2 });
    expect(text).toMatchObject({ style: { fontId: 'serif', sizeMm: 26 * 25.4 / 72, color: '#abcdef' }, direction: 'vertical', horizontalAlign: 'right', verticalAlign: 'bottom', lineHeight: 2 });
    expect(isEmptyText({ ...text, content: ' \n\t　' })).toBe(true);
    expect(isEmptyText({ ...text, content: ' \n字' })).toBe(false);
  });
  it('maps physical frame alignment onto horizontal and vertical writing axes', () => {
    const horizontal = { ...newText(0, 0, '#000'), horizontalAlign: 'right' as const, verticalAlign: 'bottom' as const };
    expect(textAlignment(horizontal)).toEqual({ textAlign: 'right', alignContent: 'end' });
    expect(textAlignment({ ...horizontal, direction: 'vertical' })).toEqual({ textAlign: 'end', alignContent: 'start' });
  });
  it('keeps the editor frame center aligned when the artboard is scaled', () => {
    expect(textEditorFrameOrigin(100, 60, 200, 80, 0.25)).toEqual({ left: -50, top: -15 });
    const origin = textEditorFrameOrigin(100, 60, 200, 80, 0.25);
    expect(origin.left + 100).toBe((100 + 100) * 0.25);
    expect(origin.top + 40).toBe((60 + 40) * 0.25);
  });
  it('resizes all corners without jumping the opposite corner', () => {
    const text = { ...newText(10, 20, '#000000'), width: 100, height: 60 };
    expect(resizeTextBox(text, 100, 60, 'nw', 15, 10)).toMatchObject({ x: 25, y: 30, width: 85, height: 50 });
    expect(resizeTextBox(text, 100, 60, 'se', 15, 10)).toMatchObject({ x: 10, y: 20, width: 115, height: 70 });
    expect(resizeTextBox(text, 100, 60, 'nw', 200, 200)).toMatchObject({ x: 86, y: 56, width: 24, height: 24 });
  });
});
