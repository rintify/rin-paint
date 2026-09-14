import type {ImageParams, TextParams, LayerType} from '../model';
import type {Layer} from './layers';
import {scaleShape} from './pageSpec';

/** Layout coordinates are mm in the model. These functions are for input/output boundaries only. */
export function scaleTextLayout(text: TextParams, factor: number): TextParams {
  return {...structuredClone(text), x: text.x * factor, y: text.y * factor,
    width: text.width === null ? null : text.width * factor,
    height: text.height === null ? null : text.height * factor};
}
export function scaleImageLayout(image: ImageParams, factor: number): ImageParams {
  return {...image, x: image.x * factor, y: image.y * factor, width: image.width * factor, height: image.height * factor};
}
export function scaleLayoutState(type: LayerType, state: unknown, factor: number): unknown {
  const value = structuredClone(state) as Layer['state'];
  if (type === 'shape' && 'shape' in value) {const s = value as Extract<Layer, {type: 'shape'}>['state']; s.shape = scaleShape(s.shape, factor);}
  if (type === 'text' && 'text' in value) {const s = value as Extract<Layer, {type: 'text'}>['state']; s.text = scaleTextLayout(s.text, factor);}
  if (type === 'image' && 'placement' in value) {const s = value as Extract<Layer, {type: 'image'}>['state']; s.placement = scaleImageLayout(s.placement, factor);}
  return value;
}
export function adoptPixelLayout(layer: Layer, ppi: number): void {
  layer.state = scaleLayoutState(layer.type, layer.state, 25.4 / ppi) as Layer['state'];
}
