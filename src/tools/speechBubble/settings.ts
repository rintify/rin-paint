import { roundMm, SIZE_MM_MAX } from '../../engine/units';
import { GEN_EI_ANTIQUE_FONT_ID } from '../../engine/text/fonts';

export type BubbleBodyKind = 'rect' | 'ellipse';
export type BubbleTailSetting = 'none' | 'pointed' | 'rounds';

export interface SpeechBubbleToolSettings {
  bodyKind: BubbleBodyKind;
  outlineColor: string;
  tailStyle: BubbleTailSetting;
  tailWidthMm: number;
  circleCount: number;
  tailSpacingDecay: number;
  textColor: string;
  fontId: string;
  fontSizePt: number;
  textPaddingMm: number;
  constrainAspect: boolean;
}

export const DEFAULT_SPEECH_BUBBLE_TOOL_SETTINGS: SpeechBubbleToolSettings = {
  bodyKind: 'ellipse',
  outlineColor: '#000000',
  tailStyle: 'pointed',
  tailWidthMm: 3,
  circleCount: 3,
  tailSpacingDecay: 0.35,
  textColor: '#000000',
  fontId: GEN_EI_ANTIQUE_FONT_ID,
  fontSizePt: 12,
  textPaddingMm: 2,
  constrainAspect: false,
};

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function mm(value: unknown, fallback: number, min = 0): number {
  const number = Number(value);
  return roundMm(Math.max(min, Math.min(SIZE_MM_MAX, Number.isFinite(number) ? number : fallback)));
}

export function normalizeSpeechBubbleToolSettings(value: unknown): SpeechBubbleToolSettings {
  const raw = value && typeof value === 'object' ? value as Partial<SpeechBubbleToolSettings> : {};
  return {
    bodyKind: raw.bodyKind === 'rect' ? 'rect' : 'ellipse',
    outlineColor: color(raw.outlineColor, DEFAULT_SPEECH_BUBBLE_TOOL_SETTINGS.outlineColor),
    tailStyle: raw.tailStyle === 'none' || raw.tailStyle === 'rounds' ? raw.tailStyle : 'pointed',
    tailWidthMm: mm(raw.tailWidthMm, DEFAULT_SPEECH_BUBBLE_TOOL_SETTINGS.tailWidthMm, .01),
    circleCount: Math.max(2, Math.min(20, Math.round(Number(raw.circleCount) || DEFAULT_SPEECH_BUBBLE_TOOL_SETTINGS.circleCount))),
    tailSpacingDecay: Math.max(0, Math.min(1, Number.isFinite(Number(raw.tailSpacingDecay))
      ? Number(raw.tailSpacingDecay) : DEFAULT_SPEECH_BUBBLE_TOOL_SETTINGS.tailSpacingDecay)),
    textColor: color(raw.textColor, DEFAULT_SPEECH_BUBBLE_TOOL_SETTINGS.textColor),
    fontId: typeof raw.fontId === 'string' && raw.fontId ? raw.fontId : DEFAULT_SPEECH_BUBBLE_TOOL_SETTINGS.fontId,
    fontSizePt: Math.max(1, Math.min(512, Number(raw.fontSizePt) || DEFAULT_SPEECH_BUBBLE_TOOL_SETTINGS.fontSizePt)),
    textPaddingMm: mm(raw.textPaddingMm, DEFAULT_SPEECH_BUBBLE_TOOL_SETTINGS.textPaddingMm),
    constrainAspect: raw.constrainAspect === true,
  };
}
