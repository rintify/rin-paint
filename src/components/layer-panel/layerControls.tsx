import type { LayerType } from '../../model';

/** 全種類が共通パラメータを持つので、設定パレットは常に開ける。 */
export function hasLayerControls(_type?: LayerType): boolean {
  return true;
}
