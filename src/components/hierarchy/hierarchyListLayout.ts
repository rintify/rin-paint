/** リスト先頭が一覧のこの位置より下なら、上端まで引き上げる (上から 30%) */
export const LIST_ORIGIN_RATIO = 0.3;

/** 先頭レイヤーの一覧内オフセットが一覧高さの 30% 以下なら、上端に揃える */
export function liftListOriginIfTooLow(top: number, scroll: number, viewHeight: number): { top: number; scroll: number } {
  if (viewHeight <= 0) return { top, scroll };
  const firstY = top - scroll;
  if (firstY < viewHeight * LIST_ORIGIN_RATIO) return { top, scroll };
  return { top: scroll, scroll };
}
