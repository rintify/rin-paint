import type { ImageState, LayerType, ShapeState, TextState } from '../../model';
import { scaleShapeBy } from '../shapes';

function scaleTextState(state: TextState, factor: number): TextState {
  const text = structuredClone(state.text);
  text.x *= factor; text.y *= factor;
  if (text.width !== null) text.width *= factor;
  if (text.height !== null) text.height *= factor;
  return { ...state, text };
}

function scaleImageState(state: ImageState, factor: number): ImageState {
  return {
    ...structuredClone(state),
    placement: {
      ...state.placement,
      x: state.placement.x * factor,
      y: state.placement.y * factor,
      width: state.placement.width * factor,
      height: state.placement.height * factor,
    },
  };
}

/** Convert runtime pixel geometry to the v11 millimetre persistence domain. */
export function encodeGeometryState(type: LayerType, state: unknown, ppi: number): unknown {
  const factor = 25.4 / ppi;
  if (type === 'shape') {
    const value = state as ShapeState;
    return { ...structuredClone(value), shape: scaleShapeBy(value.shape, factor) };
  }
  if (type === 'text') return scaleTextState(state as TextState, factor);
  if (type === 'image') return scaleImageState(state as ImageState, factor);
  return structuredClone(state);
}

/** Convert persisted millimetres to pixels only at the live rendering boundary. */
export function decodeGeometryState(type: LayerType, state: unknown, ppi: number): unknown {
  const factor = ppi / 25.4;
  if (type === 'shape') {
    const value = state as ShapeState;
    return { ...structuredClone(value), shape: scaleShapeBy(value.shape, factor) };
  }
  if (type === 'text') return scaleTextState(state as TextState, factor);
  if (type === 'image') return scaleImageState(state as ImageState, factor);
  return structuredClone(state);
}
