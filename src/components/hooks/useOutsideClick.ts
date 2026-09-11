import { useEffect, useRef, type RefObject } from 'react';

/** Calls `onOutside` on pointerdown outside `ref` (and optional extra roots). */
export function useOutsideClick(
  ref: RefObject<HTMLElement | null>,
  onOutside: () => void,
  enabled = true,
  extraRefs?: RefObject<HTMLElement | null>[],
) {
  const onOutsideRef = useRef(onOutside);
  onOutsideRef.current = onOutside;
  const extraRef = useRef(extraRefs);
  extraRef.current = extraRefs;

  useEffect(() => {
    if (!enabled) return;
    const handler = (event: PointerEvent) => {
      const node = event.target as Node;
      if (ref.current?.contains(node)) return;
      if (extraRef.current?.some(r => r.current?.contains(node))) return;
      onOutsideRef.current();
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [ref, enabled]);
}
