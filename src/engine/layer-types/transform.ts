import { renderTransform } from '../transform/render';
import {
  DEFAULT_TRANSFORM,
  normalizeTransform,
  type TransformState,
} from '../../model/transform';
import { buildCatalog } from '../parameters/catalog';
import {
  inverseMatrix,
  transformMatrix,
  transformedBounds,
} from '../transform/projective';
import type { LayerDefinition } from './definition';
import type { ParameterDefinition } from '../parameters/types';

const fields: ParameterDefinition<TransformState>[] = [
  ...(['translateX', 'translateY'] as const).map((key, index) => ({
    id: `transform.${key}`,
    semanticId: `transform.${key}`,
    groupId: 'transform',
    label: index ? '垂直移動' : '水平移動',
    editor: { kind: 'number' as const, unit: { kind: 'canvas-mm' as const } },
    surfaces: ['single', 'multi', 'link'] as const,
    read: (s: TransformState) => s[key],
    write: (s: TransformState, value: unknown) => ({
      ...s,
      [key]: Number(value),
    }),
  })),
  ...(['rotation', 'shear'] as const).map((key, index) => ({
    id: `transform.${key}`,
    semanticId: `transform.${key}`,
    groupId: 'transform',
    label: index ? 'せん断' : '回転',
    editor: {
      kind: 'number' as const,
      unit: { kind: 'degree' as const },
      ...(index ? { min: -89, max: 89 } : {}),
    },
    surfaces: ['single', 'multi', 'link'] as const,
    read: (s: TransformState) => s[key],
    write: (s: TransformState, value: unknown) => ({
      ...s,
      [key]: Number(value),
    }),
  })),
  ...(['scaleX', 'scaleY'] as const).map((key, index) => ({
    id: `transform.${key}`,
    semanticId: `transform.${key}`,
    groupId: 'transform',
    label: index ? '垂直倍率' : '水平倍率',
    editor: {
      kind: 'number' as const,
      unit: { kind: 'none' as const, suffix: '倍' },
    },
    surfaces: ['single', 'multi', 'link'] as const,
    read: (s: TransformState) => s[key] / 100,
    write: (s: TransformState, value: unknown) => ({
      ...s,
      [key]: Number(value) * 100,
    }),
  })),
];
function scaleState(state: TransformState, factor: number): TransformState {
  return {
    ...state,
    translateX: state.translateX * factor,
    translateY: state.translateY * factor,
  };
}

export const transformLayerType: LayerDefinition<'transform'> = {
  info: {
    type: 'transform',
    canMask: false,
    maskSourceLabel: null,
    supportsBlend: false,
    defaultName: (i) => `トランスフォーム ${i}`,
  },
  state: {
    initial: () => ({ ...DEFAULT_TRANSFORM }),
    clone: (s) => ({ ...s }),
    normalize: normalizeTransform,
    applyPatch: (s, p) => normalizeTransform({ ...s, ...p }),
    scale: scaleState,
  },
  codec: {
    encode: (s) => ({ ...s }),
    decode: normalizeTransform,
    scaleStored: (s, env) => scaleState(normalizeTransform(s), env.factor),
  },
  renderer: {
    draw() {},
    contentCanvas: () => null,
    effect: {
      mapBounds(bounds, layer, env) {
        return transformedBounds(
          transformMatrix(layer.state, env.artboard.w, env.artboard.h),
          bounds,
        );
      },
      mapDamage(bounds, layer, env) {
        // Bilinear filtering can sample one source pixel beyond the edited area.
        const mapped = transformedBounds(
          transformMatrix(layer.state, env.artboard.w, env.artboard.h),
          {
            x: bounds.x - 1,
            y: bounds.y - 1,
            w: bounds.w + 2,
            h: bounds.h + 2,
          },
        );
        return (
          mapped && {
            x: mapped.x - 1,
            y: mapped.y - 1,
            w: mapped.w + 2,
            h: mapped.h + 2,
          }
        );
      },
      sourceRegion(region, layer, env, available) {
        if (layer.opacity <= 0) return null;
        const inverse = inverseMatrix(
          transformMatrix(layer.state, env.artboard.w, env.artboard.h),
        );
        if (!inverse) return null;
        const bounds = transformedBounds(inverse, region) ??
          available ?? { x: 0, y: 0, w: env.artboard.w, h: env.artboard.h };
        return {
          x: bounds.x - 1,
          y: bounds.y - 1,
          w: Math.max(1, bounds.w + 2),
          h: Math.max(1, bounds.h + 2),
        };
      },
      apply: renderTransform,
    },
  },
  parameters: buildCatalog<TransformState>(
    [{ id: 'transform', label: '自由変形（ページ中央基準）' }],
    fields,
  ),
  capabilities: {},
};
