import { BLEND_OPTIONS, type BlendMode, type LayerCommon } from '../../model';
import type { CommonParameterDefinition } from './types';

const SURFACES = ['single', 'multi', 'link'] as const;
const MULTI_LINK = ['multi', 'link'] as const;

export const COMMON_PARAMETER_GROUPS = [{ id: 'layer', label: 'レイヤー' }] as const;

export const commonParameters: readonly CommonParameterDefinition[] = [
  {
    id: 'visible',
    semanticId: 'layer.visible',
    groupId: 'layer',
    label: '表示',
    editor: { kind: 'switch', trueLabel: '表示', falseLabel: '非表示' },
    surfaces: MULTI_LINK,
    read: layer => layer.visible,
    write: (_layer, value) => ({ visible: Boolean(value) }),
  },
  {
    id: 'opacity',
    semanticId: 'layer.opacity',
    groupId: 'layer',
    label: '不透明度',
    editor: { kind: 'slider', min: 0, max: 100, unit: { kind: 'percent' } },
    surfaces: SURFACES,
    read: layer => Math.round(layer.opacity * 100),
    write: (_layer, value) => ({ opacity: Math.max(0, Math.min(1, Number(value) / 100)) }),
  },
  {
    id: 'blend',
    semanticId: 'layer.blend',
    groupId: 'layer',
    label: '合成',
    editor: {
      kind: 'select',
      options: { kind: 'static', options: BLEND_OPTIONS.map(option => ({ ...option })) },
    },
    surfaces: SURFACES,
    blendOnly: true,
    read: layer => layer.blend,
    write: (_layer, value) => ({ blend: value as BlendMode }),
  },
];

export function commonForLayer(supportsBlend: boolean): readonly CommonParameterDefinition[] {
  return supportsBlend ? commonParameters : commonParameters.filter(item => !item.blendOnly);
}

export function commonFromPartial(layer: LayerCommon, patch: Partial<LayerCommon>): LayerCommon {
  return { ...layer, ...patch };
}
