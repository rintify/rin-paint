import geneiAntiqueUrl from '../../assets/fonts/GenEiAntiqueNv6-M.ttf?url';

export const GEN_EI_ANTIQUE_FONT_ID = 'genei-antique-v6';

export interface BuiltInFont {
  id: string;
  name: string;
  family: string;
  source?: string;
}

/** Fonts that are available independently of the currently open project. */
export const STANDARD_FONTS: readonly BuiltInFont[] = [
  {
    id: GEN_EI_ANTIQUE_FONT_ID,
    name: '源暎アンチック v6',
    family: '"rin-builtin-genei-antique-v6", sans-serif',
    source: geneiAntiqueUrl,
  },
  { id: 'sans', name: 'ゴシック', family: '"Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif' },
  { id: 'serif', name: '明朝', family: '"Hiragino Mincho ProN", "Yu Mincho", serif' },
  { id: 'mono', name: '等幅', family: '"MS Gothic", monospace' },
];

const builtInFontById = new Map(STANDARD_FONTS.map(font => [font.id, font]));

export function fontFamily(id: string): string {
  // Some imported layer data uses CSS generic names instead of picker ids.
  if (id === 'sans-serif') return builtInFontById.get('sans')!.family;
  if (id === 'monospace') return builtInFontById.get('mono')!.family;
  const builtIn = builtInFontById.get(id);
  if (builtIn) return builtIn.family;
  return `"rin-font-${id.replace(/[^a-zA-Z0-9-]/g, '')}"`;
}

export function builtInFontCss(sourceFor?: (font: BuiltInFont & { source: string }) => string, families?: ReadonlySet<string>): string {
  return STANDARD_FONTS
    .filter((font): font is BuiltInFont & { source: string } => !!font.source && (!families || families.has(font.id)))
    .map(font => `@font-face{font-family:"rin-builtin-${font.id}";src:url("${(sourceFor?.(font) ?? font.source).replace(/["\n\r]/g, '')}") format("truetype");font-style:normal;font-weight:400;font-display:block;}`)
    .join('\n');
}
