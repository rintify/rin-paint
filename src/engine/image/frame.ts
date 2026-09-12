import { fitSizeInBox, type ImageParams } from '../../model';
import type { RectShapeParams, ShapeParams } from '../../model/shape';
import { shapeBounds } from '../shapes';
import type { DirtyRect } from '../brush';
import type { ImageLayer, ShapeLayer } from '../layers';
import { layerHandler } from '../layer-types/registry';

export type FrameEditableLayer = ShapeLayer | ImageLayer;

export function imageFrameShape(image: ImageParams): RectShapeParams {
  return {
    kind: 'rect',
    x: image.x,
    y: image.y,
    width: image.width,
    height: image.height,
    rotation: image.rotation,
    color: '#000',
    strokeWidth: 1,
    paintMode: 'stroke',
  };
}

export function imageFromFrameShape(_image: ImageParams, shape: RectShapeParams): ImageParams {
  return {
    x: shape.x,
    y: shape.y,
    width: Math.max(0.1, shape.width),
    height: Math.max(0.1, shape.height),
    rotation: shape.rotation ?? 0,
  };
}

export function placedImage(source: { width: number; height: number }, x: number, y: number, maxWidth: number, maxHeight: number): ImageParams {
  const size = fitSizeInBox(source.width, source.height, maxWidth, maxHeight);
  return { x, y, width: size.width, height: size.height, rotation: 0 };
}

export function frameShapeOf(layer: FrameEditableLayer): ShapeParams {
  return layerHandler(layer).capabilities.frameEdit!.toShape(layer as never);
}

export function writeFrameShape(layer: FrameEditableLayer, shape: ShapeParams): void {
  layerHandler(layer).capabilities.frameEdit!.fromShape(layer as never, shape);
}

export function frameDirty(shape: ShapeParams): DirtyRect {
  const bounds = shapeBounds(shape);
  const pad = 3;
  return {
    minX: bounds.x - pad,
    minY: bounds.y - pad,
    maxX: bounds.x + bounds.w + pad,
    maxY: bounds.y + bounds.h + pad,
  };
}

