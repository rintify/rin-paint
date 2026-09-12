import { BLEND_OPTIONS, type BlendMode } from '../model';
import { mmToPx, pxToMm } from './units';
import { layerTypeHandler } from './layer-types/registry';
import type {
  LayerParameterDescriptor,
  LayerParameterLayer,
  LayerParameterValue,
} from './layer-types/types';

export type {
  LayerParameterDescriptor,
  LayerParameterLayer,
  LayerParameterValue,
} from './layer-types/types';

export function parameterSemanticId(descriptor: LayerParameterDescriptor): string {
  return descriptor.semanticId ?? descriptor.key;
}

export function readCanonicalParameter(
  descriptor: LayerParameterDescriptor,
  layer: LayerParameterLayer,
  ppi: number,
): LayerParameterValue | null {
  if (descriptor.readCanonical) return descriptor.readCanonical(layer, ppi);
  const value = descriptor.read(layer);
  return descriptor.canvasLength && typeof value === 'number' ? pxToMm(value, ppi) : value;
}

export function writeCanonicalParameter(
  descriptor: LayerParameterDescriptor,
  layer: LayerParameterLayer,
  value: LayerParameterValue,
  ppi: number,
) {
  if (descriptor.writeCanonical) return descriptor.writeCanonical(layer, value, ppi);
  return descriptor.write(layer, descriptor.canvasLength && typeof value === 'number' ? mmToPx(value, ppi) : value);
}

export function parameterValuesEqual(a: LayerParameterValue | null, b: LayerParameterValue | null): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  return Object.is(a, b);
}

export function linkableParameterMap(layer: LayerParameterLayer): Map<string, LayerParameterDescriptor> {
  return new Map(layerParameterDescriptors(layer)
    .filter(descriptor => descriptor.linkable !== false)
    .map(descriptor => [parameterSemanticId(descriptor), descriptor]));
}

/**
 * レイヤー種別を問わない汎用パラメータ。共通項のあとに、種別ハンドラが返す
 * 固有パラメータを並べる。
 */
export function layerParameterDescriptors(layer: LayerParameterLayer): LayerParameterDescriptor[] {
  const handler = layerTypeHandler(layer.type);
  const result: LayerParameterDescriptor[] = [
    {
      key: 'visible', semanticId: 'layer.visible', label: '表示', control: 'switch',
      trueLabel: '表示', falseLabel: '非表示',
      read: value => value.visible,
      write: (_value, next) => ({ visible: Boolean(next) }),
    },
    {
      key: 'opacity', semanticId: 'layer.opacity', label: '不透明度', control: 'number', min: 0, max: 100,
      read: value => Math.round(value.opacity * 100),
      write: (_value, next) => ({ opacity: Math.max(0, Math.min(1, Number(next) / 100)) }),
    },
  ];
  if (handler.supportsBlend) result.push({
    key: 'blend', semanticId: 'layer.blend', label: '合成', control: 'select',
    options: BLEND_OPTIONS.map(option => ({ ...option })),
    read: value => value.blend,
    write: (_value, next) => ({ blend: next as BlendMode }),
  });
  result.push(...handler.parameterDescriptors(layer));
  return result;
}

export function commonLayerParameterDescriptors(layers: LayerParameterLayer[], ppi = 300): LayerParameterDescriptor[] {
  if (!layers.length) return [];
  const maps = layers.map(layer => new Map(layerParameterDescriptors(layer)
    .filter(descriptor => descriptor.multiSelectable !== false)
    .map(descriptor => [parameterSemanticId(descriptor), descriptor])));
  return [...maps[0].values()]
    .filter(descriptor => maps.every(map => map.get(parameterSemanticId(descriptor))?.control === descriptor.control))
    .map(descriptor => {
      const sameStorageKey = maps.every(map => map.get(parameterSemanticId(descriptor))?.key === descriptor.key);
      return {
        ...descriptor,
        key: sameStorageKey ? descriptor.key : parameterSemanticId(descriptor),
        semanticId: parameterSemanticId(descriptor),
        canvasLength: sameStorageKey ? descriptor.canvasLength : false,
        allowTransparent: maps.every(map => map.get(parameterSemanticId(descriptor))?.allowTransparent === true),
        read: (layer: LayerParameterLayer) => {
          const own = layerParameterDescriptors(layer).find(item => parameterSemanticId(item) === parameterSemanticId(descriptor));
          return own ? (sameStorageKey ? own.read(layer) : readCanonicalParameter(own, layer, ppi)) : null;
        },
        write: (layer: LayerParameterLayer, value: LayerParameterValue) => {
          const own = layerParameterDescriptors(layer).find(item => parameterSemanticId(item) === parameterSemanticId(descriptor));
          return own ? (sameStorageKey ? own.write(layer, value) : writeCanonicalParameter(own, layer, value, ppi)) : {};
        },
      };
    });
}
