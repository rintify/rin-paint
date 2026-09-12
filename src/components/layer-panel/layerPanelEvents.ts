export const LAYER_FOCUS_EVENT = 'rin-paint:focus-layer-row';

export function focusLayerRow(id: string): void {
  window.dispatchEvent(new CustomEvent<string>(LAYER_FOCUS_EVENT, { detail: id }));
}
