import { DEFAULT_OUTLINE, type OutlineParams } from '../../model';
import { SIZE_MM_MAX, SIZE_MM_MIN, roundMm } from '../units';
import { createOutlineLayer } from '../layers';
import { LAYER_KIND_IDS } from '../modules/ids';
import { buildCatalog } from '../parameters/catalog';
import type { LayerDefinition } from './definition';
import type { OutlineState } from '../../model';
import { applyOutline, SHARP_OUTLINE_MITER_LIMIT } from './effectUtils';
import { loadOwned } from './loadOwned';

function normalize(value: Partial<OutlineParams> | undefined): OutlineParams {
  const width = Number(value?.widthMm);
  const threshold = Number(value?.alphaThreshold);
  return {
    color:
      typeof value?.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color)
        ? value.color
        : DEFAULT_OUTLINE.color,
    widthMm: Number.isFinite(width)
      ? roundMm(Math.max(SIZE_MM_MIN, Math.min(SIZE_MM_MAX, width)))
      : DEFAULT_OUTLINE.widthMm,
    alphaThreshold: Number.isFinite(threshold)
      ? Math.max(0, Math.min(1, threshold))
      : DEFAULT_OUTLINE.alphaThreshold,
    cornerStyle: value?.cornerStyle === 'sharp' ? 'sharp' : 'round',
  };
}

function cloneState(state: OutlineState): OutlineState {
  return { outline: { ...state.outline } };
}

function asOutlineState(value: unknown): OutlineState {
  const outline =
    value && typeof value === 'object' && 'outline' in value
      ? (value as { outline?: Partial<OutlineParams> }).outline
      : (value as Partial<OutlineParams> | undefined);
  return { outline: normalize(outline) };
}

const SURFACES = ['single', 'multi', 'link'] as const;

export const outlineLayerType: LayerDefinition<'outline'> = {
  info: {
    type: 'outline',
    kindId: LAYER_KIND_IDS.outline,
    revision: 1,
    canMask: true,
    maskSourceLabel: '縁どり',
    supportsBlend: false,
    defaultName: (index) => `縁どり ${index}`,
    addMenu: { group: 'effect', label: '縁どりを追加', historyLabel: '縁どりレイヤー追加' },
    effectBadge: '縁',
  },
  factory: { create: (name, id) => createOutlineLayer(name, id) },
  schema: {
    loadDefaults: { outline: { ...DEFAULT_OUTLINE } },
    createDefaults: { outline: { ...DEFAULT_OUTLINE } },
    load: (raw) => loadOwned({ outline: { ...DEFAULT_OUTLINE } }, raw, (value) => asOutlineState(value)),
  },
  state: {
    initial: () => ({ outline: { ...DEFAULT_OUTLINE } }),
    clone: cloneState,
    normalize: (state) => ({ outline: normalize(state.outline) }),
    applyPatch: (state, patch) => ({
      outline: normalize({ ...state.outline, ...patch.outline }),
    }),
    scale: (state) => cloneState(state),
  },
  codec: {
    encode: cloneState,
    decode: asOutlineState,
  },
  renderer: {
    draw() {},
    drawMask(ctx, layer, env) {
      env.drawEffectContribution(ctx, layer.id);
    },
    contentCanvas: () => null,
    effect: {
      clickableAddedPixels: true,
      paddingPx(layer, env) {
        const radius = (layer.state.outline.widthMm * env.ppi) / 25.4;
        return Math.ceil(
          radius *
            (layer.state.outline.cornerStyle === 'sharp'
              ? SHARP_OUTLINE_MITER_LIMIT
              : 1) +
            1,
        );
      },
      apply(scope, layer, env) {
        const o = layer.state.outline;
        applyOutline(
          scope,
          layer.id,
          o.color,
          o.widthMm,
          o.alphaThreshold,
          o.cornerStyle ?? 'round',
          layer.opacity,
          env,
        );
      },
    },
  },
  parameters: buildCatalog(
    [{ id: 'appearance', label: '見た目' }],
    [
      {
        id: 'outline.color',
        semanticId: 'appearance.color',
        groupId: 'appearance',
        label: '縁の色',
        editor: { kind: 'color', transparent: false },
        surfaces: SURFACES,
        read: (state) => state.outline.color,
        write: (state, value) => ({
          outline: { ...state.outline, color: String(value) },
        }),
      },
      {
        id: 'outline.widthMm',
        semanticId: 'appearance.widthMm',
        groupId: 'appearance',
        label: '太さ',
        editor: {
          kind: 'slider',
          min: SIZE_MM_MIN,
          max: SIZE_MM_MAX,
          unit: { kind: 'mm' },
        },
        surfaces: SURFACES,
        read: (state) => state.outline.widthMm,
        write: (state, value) => ({
          outline: { ...state.outline, widthMm: roundMm(Number(value)) },
        }),
      },
      {
        id: 'outline.alphaThreshold',
        semanticId: 'outline.alphaThreshold',
        groupId: 'appearance',
        label: '透明度閾値',
        editor: { kind: 'slider', min: 0, max: 100, unit: { kind: 'percent' } },
        surfaces: SURFACES,
        read: (state) => Math.round(state.outline.alphaThreshold * 100),
        write: (state, value) => ({
          outline: { ...state.outline, alphaThreshold: Number(value) / 100 },
        }),
      },
      {
        id: 'outline.cornerStyle',
        semanticId: 'appearance.cornerStyle',
        groupId: 'appearance',
        label: '縁の角',
        editor: {
          kind: 'select',
          options: {
            kind: 'static',
            options: [
              { value: 'round', label: '丸' },
              { value: 'sharp', label: '角' },
            ],
          },
        },
        surfaces: SURFACES,
        read: (state) => state.outline.cornerStyle ?? 'round',
        write: (state, value) => ({
          outline: {
            ...state.outline,
            cornerStyle: value === 'sharp' ? 'sharp' : 'round',
          },
        }),
      },
    ],
  ),
  capabilities: {
    maskSource: {
      drawOpacity: () => 1,
      uncacheable: () => true,
    },
  },
};
