/** アンカーから画面中央へ向かってポップオーバーが伸びる配置を返す。 */
export function originTowardCenter(anchor: HTMLElement | null) {
  if (!anchor) {
    return {
      anchorOrigin: { vertical: 'bottom' as const, horizontal: 'right' as const },
      transformOrigin: { vertical: 'top' as const, horizontal: 'left' as const },
    };
  }
  const rect = anchor.getBoundingClientRect();
  const towardRight = rect.left + rect.width / 2 < window.innerWidth / 2;
  const towardBottom = rect.top + rect.height / 2 < window.innerHeight / 2;
  return {
    anchorOrigin: {
      vertical: towardBottom ? 'bottom' as const : 'top' as const,
      horizontal: towardRight ? 'right' as const : 'left' as const,
    },
    transformOrigin: {
      vertical: towardBottom ? 'top' as const : 'bottom' as const,
      horizontal: towardRight ? 'left' as const : 'right' as const,
    },
  };
}
