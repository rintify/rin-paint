import { useLayoutEffect, useRef } from 'react';

const DEFAULT_MS = 220;
const DEFAULT_EASING = 'cubic-bezier(.2,.8,.2,1)';

/**
 * FLIP animation for a map of element refs keyed by id.
 * Capture previous rects before a layout change (or pass them), then call
 * after React commits the new layout via the returned `play` from a layout effect dependency.
 */
export function useFlipAnimation(deps: unknown[], durationMs = DEFAULT_MS) {
  const elements = useRef(new Map<string, HTMLElement>());
  const prevRects = useRef(new Map<string, DOMRect>());
  const motions = useRef(new Map<string, Animation>());

  const remember = () => {
    prevRects.current = new Map(
      [...elements.current].map(([id, el]) => [id, el.getBoundingClientRect()]),
    );
  };

  const setElement = (id: string, node: HTMLElement | null) => {
    if (node) elements.current.set(id, node);
    else elements.current.delete(id);
  };

  useLayoutEffect(() => {
    const previous = prevRects.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nextRects = new Map<string, DOMRect>();
    for (const [id, element] of elements.current) {
      motions.current.get(id)?.cancel();
      const nextRect = element.getBoundingClientRect();
      nextRects.set(id, nextRect);
      if (reduced) continue;
      const oldRect = previous.get(id);
      if (!oldRect) {
        if (previous.size) {
          motions.current.set(
            id,
            element.animate(
              [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'scale(1)' }],
              { duration: durationMs, easing: DEFAULT_EASING },
            ),
          );
        }
        continue;
      }
      const dx = oldRect.left - nextRect.left;
      const dy = oldRect.top - nextRect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      motions.current.set(
        id,
        element.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: durationMs, easing: DEFAULT_EASING },
        ),
      );
    }
    prevRects.current = nextRects;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls when to replay
  }, deps);

  useLayoutEffect(() => () => {
    for (const animation of motions.current.values()) animation.cancel();
  }, []);

  return { setElement, remember, elements };
}
