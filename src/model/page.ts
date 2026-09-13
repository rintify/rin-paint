export interface PageSpec {
  widthMm: number;
  heightMm: number;
  ppi: number;
}

export const DEFAULT_PAGE: PageSpec = {
  widthMm: (1600 * 25.4) / 300,
  heightMm: (1200 * 25.4) / 300,
  ppi: 300,
};

/** 短辺×長辺（縦向き）の一般的な用紙サイズ。B列は JIS B。 */
export interface PaperSizeTemplate {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
}

export const PAPER_SIZE_TEMPLATES: readonly PaperSizeTemplate[] = [
  { id: 'a3', label: 'A3', widthMm: 297, heightMm: 420 },
  { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297 },
  { id: 'a5', label: 'A5', widthMm: 148, heightMm: 210 },
  { id: 'a6', label: 'A6', widthMm: 105, heightMm: 148 },
  { id: 'b4', label: 'B4', widthMm: 257, heightMm: 364 },
  { id: 'b5', label: 'B5', widthMm: 182, heightMm: 257 },
  { id: 'b6', label: 'B6', widthMm: 128, heightMm: 182 },
  { id: 'hagaki', label: 'はがき', widthMm: 100, heightMm: 148 },
];

const PAPER_SIZE_MM_EPS = 0.05;

function approxMm(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= PAPER_SIZE_MM_EPS;
}

export function matchingPaperTemplate(widthMm: number, heightMm: number): PaperSizeTemplate | null {
  return PAPER_SIZE_TEMPLATES.find(template =>
    (approxMm(widthMm, template.widthMm) && approxMm(heightMm, template.heightMm))
    || (approxMm(widthMm, template.heightMm) && approxMm(heightMm, template.widthMm)),
  ) ?? null;
}

export function paperSizeDimensions(template: PaperSizeTemplate, landscape: boolean): { widthMm: number; heightMm: number } {
  return landscape
    ? { widthMm: template.heightMm, heightMm: template.widthMm }
    : { widthMm: template.widthMm, heightMm: template.heightMm };
}

/** ペン色として「透明 (消す)」を表す特別な値 */
export const TRANSPARENT = 'transparent';

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

export const MIN_ART_SIZE = 64;
export const MAX_ART_SIZE = 4096;
