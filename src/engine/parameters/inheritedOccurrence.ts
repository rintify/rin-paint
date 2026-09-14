/** Deterministic occurrence IDs also cover children first observed through an unopened variant. */
export function inheritedOccurrenceId(canvasId: string, sourceChildId: string): string {
  return `I${canvasId.length}:${canvasId}:${sourceChildId}`;
}
