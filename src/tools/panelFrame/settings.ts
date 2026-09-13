import { roundMm, SIZE_MM_MAX } from '../../engine/units';

export interface PanelFrameToolSettings {
  outlineColor: string;
  constrainAspect: boolean;
}

export const DEFAULT_PANEL_FRAME_TOOL_SETTINGS: PanelFrameToolSettings = {
  outlineColor: '#000000',
  constrainAspect: false,
};

export function normalizePanelFrameToolSettings(value: unknown): PanelFrameToolSettings {
  const raw = value && typeof value === 'object' ? value as Partial<PanelFrameToolSettings> : {};
  return {
    outlineColor: typeof raw.outlineColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.outlineColor)
      ? raw.outlineColor : DEFAULT_PANEL_FRAME_TOOL_SETTINGS.outlineColor,
    constrainAspect: raw.constrainAspect === true,
  };
}

export function normalizeOutlineWidthMm(value: number): number {
  return roundMm(Math.max(.01, Math.min(SIZE_MM_MAX, Number.isFinite(value) ? value : 1)));
}
