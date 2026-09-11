import { BLEND_OPTIONS, type BlendMode } from '../model';
import { layerTypeHandler } from './layer-types/registry';
import type {
  LayerParameterDescriptor,
  LayerParameterLayer,
} from './layer-types/types';

export type {
  LayerParameterDescriptor,
  LayerParameterLayer,
  LayerParameterValue,
} from './layer-types/types';

/**
 * レイヤー種別を問わない汎用パラメータ。共通項のあとに、種別ハンドラが返す
 * 固有パラメータを並べる。
 */
export function layerParameterDescriptors(layer: LayerParameterLayer): LayerParameterDescriptor[] {
  const handler = layerTypeHandler(layer.type);
  const result: LayerParameterDescriptor[] = [
    {
      key: 'visible', label: '表示', control: 'switch',
      read: value => value.visible,
      write: (_value, next) => ({ visible: Boolean(next) }),
    },
    {
      key: 'opacity', label: '不透明度', control: 'number', min: 0, max: 100,
      read: value => Math.round(value.opacity * 100),
      write: (_value, next) => ({ opacity: Math.max(0, Math.min(1, Number(next) / 100)) }),
    },
  ];
  if (handler.supportsBlend) result.push({
    key: 'blend', label: '合成', control: 'select',
    options: BLEND_OPTIONS.map(option => ({ ...option })),
    read: value => value.blend,
    write: (_value, next) => ({ blend: next as BlendMode }),
  });
  result.push(...handler.parameterDescriptors(layer));
  return result;
}

export function commonLayerParameterDescriptors(layers: LayerParameterLayer[]): LayerParameterDescriptor[] {
  if (!layers.length) return [];
  const maps = layers.map(layer => new Map(layerParameterDescriptors(layer).map(descriptor => [descriptor.key, descriptor])));
  return [...maps[0].values()]
    .filter(descriptor => maps.every(map => map.get(descriptor.key)?.control === descriptor.control))
    .map(descriptor => ({
      ...descriptor,
      allowTransparent: maps.every(map => map.get(descriptor.key)?.allowTransparent === true),
      read: layer => {
        const own = layerParameterDescriptors(layer).find(item => item.key === descriptor.key);
        return own ? own.read(layer) : null;
      },
      write: (layer, value) => {
        const own = layerParameterDescriptors(layer).find(item => item.key === descriptor.key);
        return own ? own.write(layer, value) : {};
      },
    }));
}
