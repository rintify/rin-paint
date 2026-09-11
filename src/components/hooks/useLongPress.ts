import { useEffect, useRef } from 'react';

const DEFAULT_MS = 450;
const DEFAULT_MOVE_TOLERANCE = 8;

/** Fires `onLongPress` after a dwell if the pointer stays roughly still. */
export function useLongPress(
  onLongPress: () => void,
  options?: { ms?: number; moveTolerance?: number },
) {
  const ms = options?.ms ?? DEFAULT_MS;
  const moveTolerance = options?.moveTolerance ?? DEFAULT_MOVE_TOLERANCE;
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const callback = useRef(onLongPress);
  callback.current = onLongPress;

  useEffect(() => () => {
    if (press.current) clearTimeout(press.current.timer);
  }, []);

  const clear = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  return {
    onPointerDown: (event: { button?: number; clientX: number; clientY: number }) => {
      if (event.button !== undefined && event.button !== 0) return;
      clear();
      const timer = setTimeout(() => {
        press.current = null;
        callback.current();
      }, ms);
      press.current = { x: event.clientX, y: event.clientY, timer };
    },
    onPointerMove: (event: { clientX: number; clientY: number }) => {
      const p = press.current;
      if (!p) return;
      if (Math.hypot(event.clientX - p.x, event.clientY - p.y) >= moveTolerance) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
  };
}
