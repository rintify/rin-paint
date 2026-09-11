import { toCanvas } from 'html-to-image';
import type { ProjectFont, TextParams, TextStyle } from '../../types';
import { styleAt } from './model';

export const STANDARD_FONTS = [{ id: 'sans', name: 'ゴシック' }, { id: 'serif', name: '明朝' }, { id: 'mono', name: '等幅' }];
export function fontFamily(id: string): string {
  if (id === 'sans') return '"Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
  if (id === 'serif') return '"Hiragino Mincho ProN", "Yu Mincho", serif';
  if (id === 'mono') return '"MS Gothic", monospace';
  return `"rin-font-${id.replace(/[^a-zA-Z0-9-]/g, '')}"`;
}
let loadedFonts: ProjectFont[] = [];
let fontSheet: HTMLStyleElement | null = null;
let fontEpoch = 0;
export async function loadFonts(fonts: ProjectFont[]): Promise<void> {
  const epoch = ++fontEpoch;
  loadedFonts = fonts;
  fontSheet ??= document.head.appendChild(document.createElement('style'));
  fontSheet.textContent = fontCss(fonts);
  await Promise.all(fonts.map(f => document.fonts.load(`16px ${fontFamily(f.id)}`)));
  if (epoch !== fontEpoch) return;
}
function fontCss(fonts = loadedFonts): string {
  return fonts.map(f => `@font-face{font-family:${fontFamily(f.id)};src:url("${f.dataUrl.replace(/["\n\r]/g, '')}");}`).join('\n');
}
function applyStyle(el: HTMLElement, style: TextStyle, ppi: number): void {
  el.style.fontFamily = fontFamily(style.fontId);
  el.style.fontSize = `${style.sizePt * ppi / 72}px`;
  el.style.color = style.color;
}
export function styleTextRoot(el: HTMLElement, text: TextParams, ppi: number): void {
  Object.assign(el.style, {
    writingMode: text.direction === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
    textOrientation: 'mixed', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'normal',
    lineBreak: 'strict', lineHeight: String(text.lineHeight), boxSizing: 'border-box',
    width: text.width === null ? 'max-content' : `${text.width}px`,
    height: text.height === null ? 'max-content' : `${text.height}px`,
    minWidth: '1em', minHeight: '1em', padding: '0', margin: '0', border: '0',
    overflow: 'visible', textAlign: 'start',
  });
  applyStyle(el, text.style, ppi);
}
/** Shared DOM for editable text and its composited bitmap. */
export function populateText(el: HTMLElement, text: TextParams, ppi: number): void {
  styleTextRoot(el, text, ppi);
  const fragment = document.createDocumentFragment();
  const points = [...new Set([0, text.content.length, ...text.ranges.flatMap(r => [r.start, r.end]), ...text.ruby.flatMap(r => [r.start, r.end])])].sort((a, b) => a - b);
  let rubyEl: HTMLElement | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i], end = points[i + 1];
    const ruby = text.ruby.find(r => r.start <= start && r.end > start);
    if (ruby?.start === start) {
      rubyEl = document.createElement('ruby');
      rubyEl.style.rubyPosition = 'over';
      fragment.append(rubyEl);
    }
    const span = document.createElement('span');
    span.textContent = text.content.slice(start, end);
    applyStyle(span, styleAt(text, start), ppi);
    (rubyEl ?? fragment).append(span);
    if (ruby && ruby.end === end && rubyEl) {
      const rt = document.createElement('rt');
      rt.textContent = ruby.text;
      rt.contentEditable = 'false';
      applyStyle(rt, styleAt(text, ruby.start), ppi);
      rt.style.fontSize = `${styleAt(text, ruby.start).sizePt * ppi / 144}px`;
      rt.style.userSelect = 'none';
      rubyEl.append(rt);
      rubyEl = null;
    }
  }
  if (!text.content || text.content.endsWith('\n')) {
    const br = document.createElement('br');
    br.dataset.placeholder = 'true';
    fragment.append(br);
  }
  el.replaceChildren(fragment);
}

interface Cache { key: string; canvas: HTMLCanvasElement | null; ready: Promise<void>; error?: unknown }
/**
 * DOM + html-to-image による文字ビットマップ生成。
 * 公開 API は request / draw / ready / get / clear / retain。
 * 将来 Canvas 直描画実装へ差し替え可能な境界として扱う。
 */
export class TextRenderer {
  private cache = new Map<string, Cache>();
  clear(): void { this.cache.clear(); }
  retain(ids: Set<string>): void { for (const id of this.cache.keys()) if (!ids.has(id)) this.cache.delete(id); }
  get(id: string): HTMLCanvasElement | null { return this.cache.get(id)?.canvas ?? null; }
  request(id: string, text: TextParams, ppi: number, onReady: () => void): void {
    const key = JSON.stringify([{ ...text, x: 0, y: 0 }, ppi, fontEpoch]);
    if (this.cache.get(id)?.key === key) return;
    const item: Cache = { key, canvas: this.get(id), ready: Promise.resolve() };
    this.cache.set(id, item);
    item.ready = (async () => {
      const host = document.createElement('div');
      Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', pointerEvents: 'none', boxSizing: 'border-box', display: 'flow-root' });
      const node = document.createElement('div');
      populateText(node, text, ppi);
      host.append(node);
      document.body.append(host);
      try {
        const families = new Set([text.style.fontId, ...text.ranges.map(r => r.fontId)]);
        await Promise.all([...families].map(id => document.fonts.load(`16px ${fontFamily(id)}`)));
        if (this.cache.get(id) !== item) return;
        const rect = node.getBoundingClientRect();
        // Padding accommodates ruby above/right without clipping it from the bitmap.
        const pad = Math.ceil(Math.max(text.style.sizePt, ...text.ranges.map(r => r.sizePt)) * ppi / 72);
        const range = document.createRange();
        range.selectNodeContents(node);
        const measured = range.getBoundingClientRect();
        const bounds = text.content && (measured.width || measured.height) ? measured : rect;
        const left = Math.max(0, rect.left - bounds.left);
        const top = Math.max(0, rect.top - bounds.top);
        const right = Math.max(0, bounds.right - rect.right);
        const bottom = Math.max(0, bounds.bottom - rect.bottom);
        const offsetX = Math.ceil(pad + left), offsetY = Math.ceil(pad + top);
        host.style.padding = `${offsetY}px ${Math.ceil(pad + right)}px ${Math.ceil(pad + bottom)}px ${offsetX}px`;
        const width = Math.max(1, Math.ceil(rect.width + left + right + pad * 2));
        const height = Math.max(1, Math.ceil(rect.height + top + bottom + pad * 2));
        const canvas = await toCanvas(host, { width, height, pixelRatio: 1, fontEmbedCSS: fontCss(loadedFonts.filter(font => families.has(font.id))), style: { position: 'static', left: 'auto', top: 'auto', width: `${width}px`, height: `${height}px` } });
        canvas.dataset.textPadding = String(pad);
        canvas.dataset.textOffsetX = String(offsetX);
        canvas.dataset.textOffsetY = String(offsetY);
        canvas.dataset.textWidth = String(rect.width);
        canvas.dataset.textHeight = String(rect.height);
        if (this.cache.get(id) === item) { item.canvas = canvas; onReady(); }
      } catch (error) { if (this.cache.get(id) === item) item.error = error; }
      finally { host.remove(); }
    })();
  }
  async ready(): Promise<void> {
    let entries: Cache[];
    do { entries = [...this.cache.values()]; await Promise.all(entries.map(c => c.ready)); }
    while ([...this.cache.values()].some(c => !entries.includes(c)));
    const failed = [...this.cache.values()].find(c => c.error);
    if (failed) throw new Error('文字の描画に失敗しました。フォントまたは文字枠を確認してください。');
  }
  draw(ctx: CanvasRenderingContext2D, id: string, text: TextParams): void {
    const canvas = this.get(id);
    if (!canvas) return;
    const offsetX = Number(canvas.dataset.textOffsetX ?? 0), offsetY = Number(canvas.dataset.textOffsetY ?? 0);
    const width = Number(canvas.dataset.textWidth ?? canvas.width), height = Number(canvas.dataset.textHeight ?? canvas.height);
    const rotation = text.rotation ?? 0;
    ctx.save();
    ctx.translate(text.x + width / 2, text.y + height / 2);
    ctx.rotate(rotation);
    ctx.drawImage(canvas, -width / 2 - offsetX, -height / 2 - offsetY);
    ctx.restore();
  }
}
