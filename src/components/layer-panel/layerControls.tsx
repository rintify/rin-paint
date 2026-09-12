import type { ComponentType } from 'react';
import type { LayerMeta, LayerType } from '../../model';
import { TextControls } from '../TextControls';
import { AdjustControls } from './AdjustControlsPanel';
import { ShapeControls } from './ShapeControlsPanel';
import { OutlineControls } from './OutlineControlsPanel';
import { ClipControls } from './ClipControlsPanel';

/** レイヤー種別ごとの設定パネル。UI 層に置き、エンジン import から切り離す。 */
const LAYER_CONTROLS: Partial<Record<LayerType, ComponentType<{ meta: LayerMeta }>>> = {
  adjust: AdjustControls,
  outline: OutlineControls,
  clip: ClipControls,
  shape: ShapeControls,
  text: TextControls,
};

export function layerControlsPanel(type: LayerType): ComponentType<{ meta: LayerMeta }> | undefined {
  return LAYER_CONTROLS[type];
}

export function hasLayerControls(type: LayerType): boolean {
  return !!LAYER_CONTROLS[type];
}
