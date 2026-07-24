import type { StrokePoint } from '../../types';

export interface Tool {
  onDown(p: StrokePoint, e: PointerEvent): void;
  onMove(p: StrokePoint, e: PointerEvent): void;
  onUp(p: StrokePoint, e: PointerEvent): void;
  /** pointercancel 等での中断 */
  cancel?(): void;
  /** オーバーレイキャンバスへのプレビュー描画 (毎フレーム呼ばれる) */
  drawOverlay?(ctx: CanvasRenderingContext2D): void;
  /** 合成時にアクティブレイヤーの直上に描くもの (浮動選択など) */
  drawAboveLayer?(ctx: CanvasRenderingContext2D): void;
}
