import type { CanvasState } from '../../model';
import { buildCatalog } from '../parameters/catalog';
import type { LayerDefinition } from './definition';

const clone = (state: CanvasState): CanvasState => ({ propagateTransforms: state.propagateTransforms !== false });
export const canvasLayerType: LayerDefinition<'canvas'> = {
  info: { type: 'canvas', canMask: true, maskSourceLabel: 'キャンバス', supportsBlend: true, defaultName: index => `キャンバス ${index}` },
  state: {
    initial: () => ({ propagateTransforms: true }), clone, normalize: clone,
    applyPatch: (state, patch) => clone({ ...state, ...patch }), scale: clone,
  },
  codec: {
    encode: clone,
    decode: value => value && typeof value === 'object' ? clone(value as CanvasState) : null,
  },
  renderer: {
    // The compositor owns evaluation of the isolated child scope.
    draw() {}, bakeOnto() {}, contentCanvas: () => null,
    drawMask(ctx, layer, env) { env.drawCanvasScope(ctx, layer.id); },
  },
  parameters: buildCatalog([{ id: 'canvas', label: 'キャンバス' }], [{
    id: 'propagateTransforms', semanticId: 'canvas.propagateTransforms', groupId: 'canvas', label: 'トランスフォームを子に伝播',
    editor: { kind: 'switch', trueLabel: 'ON', falseLabel: 'OFF' }, surfaces: ['single', 'multi', 'link'],
    read: (state: CanvasState) => state.propagateTransforms,
    write: (_state, value) => ({ propagateTransforms: Boolean(value) }),
  }]),
  capabilities: {},
};
