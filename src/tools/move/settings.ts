export interface MoveToolSettings {
  includeDescendants: boolean;
}

export function normalizeMoveToolSettings(value: unknown): MoveToolSettings {
  const raw = value && typeof value === 'object'
    ? value as Partial<MoveToolSettings>
    : {};
  return { includeDescendants: raw.includeDescendants === true };
}
