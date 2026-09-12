export type Hsv = { h: number; s: number; v: number };

export function parseHex(value: string): string | null {
  const raw = value.trim();
  const six = /^#?([0-9a-f]{6})$/i.exec(raw);
  if (six) return `#${six[1].toLowerCase()}`;
  const three = /^#?([0-9a-f]{3})$/i.exec(raw);
  if (!three) return null;
  const [r, g, b] = three[1];
  return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
}

export function hexToRgb(hex: string): [number, number, number] {
  const parsed = parseHex(hex);
  if (!parsed) throw new Error(`invalid hex: ${hex}`);
  return [
    parseInt(parsed.slice(1, 3), 16),
    parseInt(parsed.slice(3, 5), 16),
    parseInt(parsed.slice(5, 7), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const byte = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rr) h = ((gg - bb) / delta) % 6;
    else if (max === gg) h = (bb - rr) / delta + 2;
    else h = (rr - gg) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHsv(r, g, b);
}

export function hsvToHex(hsv: Hsv): string {
  const [r, g, b] = hsvToRgb(hsv.h, hsv.s, hsv.v);
  return rgbToHex(r, g, b);
}

export function hueHex(h: number): string {
  return hsvToHex({ h, s: 1, v: 1 });
}
