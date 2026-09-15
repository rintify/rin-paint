/** リスト先頭が一覧のこの位置より下なら、上端まで引き上げる (上から 30%) */
export const LIST_ORIGIN_RATIO = 0.3;

/** 下半分の行がツリーの開閉で上へ移る場合は、画面内の位置を固定しない。 */
export function shouldPreserveRowAnchor(
  anchorY: number,
  naturalY: number,
  viewHeight: number,
): boolean {
  return anchorY < viewHeight / 2 || naturalY >= anchorY;
}

/** 先頭レイヤーの一覧内オフセットが一覧高さの 30% 以下なら、上端に揃える */
export function liftListOriginIfTooLow(top: number, scroll: number, viewHeight: number): { top: number; scroll: number } {
  if (viewHeight <= 0) return { top, scroll };
  const firstY = top - scroll;
  if (firstY < viewHeight * LIST_ORIGIN_RATIO) return { top, scroll };
  return { top: scroll, scroll };
}
