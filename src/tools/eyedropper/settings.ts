export type EyedropperSource = 'active-layer' | 'final-color';

export interface EyedropperToolSettings {
  source: EyedropperSource;
}

export const DEFAULT_EYEDROPPER_TOOL_SETTINGS: EyedropperToolSettings = {
  source: 'active-layer',
};

export function normalizeEyedropperToolSettings(value: unknown): EyedropperToolSettings {
  const raw = value && typeof value === 'object'
    ? value as Partial<EyedropperToolSettings>
    : {};
  return {
    source: raw.source === 'final-color' ? 'final-color' : 'active-layer',
  };
}
