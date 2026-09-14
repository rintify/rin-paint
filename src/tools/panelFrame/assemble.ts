import {
  createClipLayer,
  createOutlineLayer,
  createRasterLayer,
  createShapeLayer,
  type Layer,
} from '../../engine/layers';
import type { ShapeParams } from '../../model';

export interface PanelFrameLayerOptions {
  outlineColor: string;
  outlineWidthMm: number;
}

export function assemblePanelFrame(
  artboard: { w: number; h: number },
  shape: ShapeParams,
  options: PanelFrameLayerOptions,
): { root: Layer; layers: Layer[]; selectedId: string; label: string } {
  const root = createShapeLayer('コマ', shape);
  const raster = createRasterLayer('コマ描画', artboard.w, artboard.h, undefined, true);
  const clip = createClipLayer('コマ内クリップ');
  const outline = createOutlineLayer('コマ枠');
  root.childIds = [raster.id, clip.id];
  raster.parentId = root.id;
  clip.parentId = root.id;
  clip.childIds = [outline.id];
  clip.state.maskLayerIds = [root.id];
  outline.parentId = clip.id;
  outline.state.outline = {
    ...outline.state.outline,
    color: options.outlineColor,
    widthMm: options.outlineWidthMm,
    cornerStyle: 'sharp',
  };
  return {
    root,
    layers: [root, raster, clip, outline],
    selectedId: raster.id,
    label: 'コマを追加',
  };
}
