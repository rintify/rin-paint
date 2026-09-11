import { DEFAULT_TEXT_TOOL_SETTINGS, type TextParams, type TextStyle, type TextToolSettings } from '../../types';

export const DEFAULT_TEXT_STYLE: TextStyle = { fontId: DEFAULT_TEXT_TOOL_SETTINGS.fontId, color: '#222222', sizePt: DEFAULT_TEXT_TOOL_SETTINGS.sizePt };
export function newText(x: number, y: number, color: string, width: number | null = null, height: number | null = null, settings: TextToolSettings = DEFAULT_TEXT_TOOL_SETTINGS): TextParams {
  return { content: '', style: { fontId: settings.fontId, sizePt: settings.sizePt, color: color === 'transparent' ? '#222222' : color }, ranges: [], ruby: [], direction: settings.direction, lineHeight: settings.lineHeight, x, y, width, height, rotation: 0 };
}

export function isEmptyText(text: TextParams): boolean {
  return text.content.trim().length === 0;
}

export type TextResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
export function resizeTextBox(
  text: TextParams,
  width: number,
  height: number,
  corner: TextResizeCorner,
  dx: number,
  dy: number,
  minimum = 24,
): TextParams {
  const right = text.x + width;
  const bottom = text.y + height;
  const nextLeft = corner.endsWith('w') ? Math.min(right - minimum, text.x + dx) : text.x;
  const nextTop = corner.startsWith('n') ? Math.min(bottom - minimum, text.y + dy) : text.y;
  const nextRight = corner.endsWith('e') ? Math.max(text.x + minimum, right + dx) : right;
  const nextBottom = corner.startsWith('s') ? Math.max(text.y + minimum, bottom + dy) : bottom;
  return { ...text, x: nextLeft, y: nextTop, width: nextRight - nextLeft, height: nextBottom - nextTop };
}
export function styleAt(text: TextParams, index: number): TextStyle {
  const range = text.ranges.find(r => index >= r.start && index < r.end);
  return range ? { fontId: range.fontId, color: range.color, sizePt: range.sizePt } : { ...text.style };
}
function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return a.fontId === b.fontId && a.color === b.color && a.sizePt === b.sizePt;
}
export function normalizeRanges(text: TextParams): TextParams {
  const points = [...new Set([0, text.content.length, ...text.ranges.flatMap(r => [r.start, r.end])])].filter(n => n >= 0 && n <= text.content.length).sort((a, b) => a - b);
  const ranges: TextParams['ranges'] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i], end = points[i + 1];
    if (start === end) continue;
    const style = styleAt(text, start);
    const last = ranges.at(-1);
    if (last && sameStyle(last, style)) last.end = end;
    else ranges.push({ ...style, start, end });
  }
  return { ...text, ranges };
}
export function formatRange(text: TextParams, start: number, end: number, patch: Partial<TextStyle>): TextParams {
  if (start === end) return { ...normalizeRanges(text), style: { ...text.style, ...patch } };
  const source = normalizeRanges(text);
  const ranges = source.ranges.flatMap(r => {
    if (r.end <= start || r.start >= end) return [r];
    return [
      ...(r.start < start ? [{ ...r, end: start }] : []),
      { ...r, ...patch, start: Math.max(r.start, start), end: Math.min(r.end, end) },
      ...(r.end > end ? [{ ...r, start: end }] : []),
    ];
  });
  return normalizeRanges({ ...text, ranges });
}
/** One contiguous edit, preserving unaffected formatting/ruby and UTF-16 DOM offsets. */
export function replaceText(text: TextParams, content: string, typingStyle: TextStyle): TextParams {
  let start = 0;
  while (start < text.content.length && start < content.length && text.content[start] === content[start]) start++;
  if (start > 0 && /[\uD800-\uDBFF]/.test(text.content[start - 1])) start--;
  let oldEnd = text.content.length, newEnd = content.length;
  while (oldEnd > start && newEnd > start && text.content[oldEnd - 1] === content[newEnd - 1]) { oldEnd--; newEnd--; }
  if (oldEnd < text.content.length && /[\uDC00-\uDFFF]/.test(text.content[oldEnd])) { oldEnd++; newEnd++; }
  const delta = newEnd - oldEnd;
  const ranges = normalizeRanges(text).ranges.flatMap(r => [
    ...(r.start < start ? [{ ...r, end: Math.min(r.end, start) }] : []),
    ...(r.end > oldEnd ? [{ ...r, start: Math.max(r.start, oldEnd) + delta, end: r.end + delta }] : []),
  ]);
  if (newEnd > start) ranges.push({ ...typingStyle, start, end: newEnd });
  ranges.sort((a, b) => a.start - b.start);
  const ruby = text.ruby.flatMap(r => {
    if (r.end <= start) return [r];
    if (r.start >= oldEnd) return [{ ...r, start: r.start + delta, end: r.end + delta }];
    return [];
  });
  return normalizeRanges({ ...text, content, ranges, ruby });
}
export function setRuby(text: TextParams, start: number, end: number, reading: string): TextParams {
  if (start >= end || text.content.slice(start, end).includes('\n')) return text;
  return { ...text, ruby: [...text.ruby.filter(r => r.end <= start || r.start >= end), ...(reading.trim() ? [{ start, end, text: reading.trim() }] : [])].sort((a, b) => a.start - b.start) };
}
