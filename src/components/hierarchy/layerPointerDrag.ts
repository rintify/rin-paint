import type { PaintEngine } from '../../engine/PaintEngine';
import { appAlert } from '../AppDialogs';

let consumeClick = false;
export function consumeLayerDragClick(): boolean {const result = consumeClick; consumeClick = false; return result;}

/** One pointer protocol works across the bin dialog and the hierarchy without HTML drag ownership. */
export function beginLayerPointerDrag(
  engine: PaintEngine, event: {button: number; pointerId: number; clientX: number; clientY: number},
  payload: {kind: 'layer' | 'bin'; id: string},
): void {
  if (event.button !== 0) return;
  let moved = false;
  const move = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) return;
    moved ||= Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) > 6;
  };
  const finish = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) return;
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel);
    if (!moved) return;
    consumeClick = true;
    const elements = document.elementsFromPoint(next.clientX, next.clientY);
    const bin = elements.find(element => element.closest('[data-bin-drop]'));
    const hierarchy = elements.map(element => element.closest<HTMLElement>('[data-hierarchy-drop]')).find(Boolean);
    const action = payload.kind === 'layer' && bin ? engine.bins.register(payload.id)
      : payload.kind === 'bin' && hierarchy ? engine.bins.addToPage(payload.id, hierarchy.dataset.hierarchyDrop || undefined) : null;
    void action?.catch(error => appAlert(String(error)));
  };
  const cancel = () => {window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel);};
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel);
}
