export interface MoveToolSettings {
  includeDescendants: boolean;
  snapEnabled: boolean;
}

export function normalizeMoveToolSettings(value: unknown): MoveToolSettings {
  const raw = value && typeof value === 'object'
    ? value as Partial<MoveToolSettings>
    : {};
  return {
    includeDescendants: raw.includeDescendants === true,
    snapEnabled: raw.snapEnabled !== false,
  };
}
