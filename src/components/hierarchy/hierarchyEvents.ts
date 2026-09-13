export const HIERARCHY_FOCUS_EVENT = 'rin-paint:focus-hierarchy-row';

export function focusLayerRow(id: string): void {
  window.dispatchEvent(new CustomEvent<string>(HIERARCHY_FOCUS_EVENT, { detail: id }));
}
