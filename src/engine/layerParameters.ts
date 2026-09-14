import { commonParametersOf } from './parameters/intersect';
import { hostFromLayer, linkableParameters, parameterById, parametersFor } from './parameters/host';
import { fromCanonical, toCanonical } from './parameters/codec';
import { parameterValuesEqual } from './parameters/catalog';
import type { ParameterHost } from './parameters/host';
import type { ParameterValue } from './parameters/types';

export type LayerParameterValue = ParameterValue;
export type LayerParameterLayer = ParameterHost;

/** @deprecated Use Parameter Catalog ids. Kept as a semantic alias during UI migration. */
export interface LayerParameterDescriptor {
  key: string;
  semanticId?: string;
  label: string;
  control: 'number' | 'color' | 'select' | 'switch';
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  allowTransparent?: boolean;
  nullable?: boolean;
  trueLabel?: string;
  falseLabel?: string;
  physicalLength?: boolean;
  linkable?: boolean;
  multiSelectable?: boolean;
  read(layer: LayerParameterLayer): ParameterValue;
  write(layer: LayerParameterLayer, value: ParameterValue): object;
}

function asDescriptor(layer: LayerParameterLayer, id: string): LayerParameterDescriptor | undefined {
  const host = hostFromLayer(layer);
  const item = parameterById(host, id);
  if (!item) return undefined;
  return {
    key: item.id,
    semanticId: item.semanticId,
    label: item.label,
    control: item.editor.kind === 'slider' ? 'number' : item.editor.kind,
    min: item.editor.kind === 'slider' || item.editor.kind === 'number' ? item.editor.min : undefined,
    max: item.editor.kind === 'slider' || item.editor.kind === 'number' ? item.editor.max : undefined,
    options: item.editor.kind === 'select' && item.editor.options.kind === 'static'
      ? [...item.editor.options.options]
      : undefined,
    allowTransparent: item.editor.kind === 'color' ? item.editor.transparent : undefined,
    nullable: item.editor.kind === 'number' || item.editor.kind === 'slider' ? item.editor.nullable : undefined,
    trueLabel: item.editor.kind === 'switch' ? item.editor.trueLabel : undefined,
    falseLabel: item.editor.kind === 'switch' ? item.editor.falseLabel : undefined,
    physicalLength: (item.editor.kind === 'slider' || item.editor.kind === 'number') && item.editor.unit?.kind === 'mm',
    linkable: item.surfaces.includes('link'),
    multiSelectable: item.surfaces.includes('multi'),
    read: value => item.read(value, (value as LayerParameterLayer).state),
    write: (value, next) => item.write(value, (value as LayerParameterLayer).state, next),
  };
}

export function parameterSemanticId(descriptor: { semanticId?: string; key: string }): string {
  return descriptor.semanticId ?? descriptor.key;
}

export function layerParameterDescriptors(layer: LayerParameterLayer): LayerParameterDescriptor[] {
  return parametersFor(hostFromLayer(layer)).map(item => asDescriptor(layer, item.id)!);
}

export function commonLayerParameterDescriptors(layers: LayerParameterLayer[], _ppi = 300): LayerParameterDescriptor[] {
  const hosts = layers.map(hostFromLayer);
  return commonParametersOf(hosts, 'multi').map(item => asDescriptor(layers[0], item.semanticId)!).filter(Boolean);
}

export function linkableParameterMap(layer: LayerParameterLayer): Map<string, LayerParameterDescriptor> {
  const map = new Map<string, LayerParameterDescriptor>();
  for (const [id, item] of linkableParameters(hostFromLayer(layer))) {
    const descriptor = asDescriptor(layer, item.id);
    if (descriptor) map.set(id, descriptor);
  }
  return map;
}

export function readCanonicalParameter(
  descriptor: LayerParameterDescriptor,
  layer: LayerParameterLayer,
  ppi: number,
): ParameterValue {
  const item = parameterById(hostFromLayer(layer), descriptor.semanticId ?? descriptor.key);
  if (!item) return descriptor.read(layer);
  return toCanonical(item, item.read(layer, layer.state), ppi);
}

export function writeCanonicalParameter(
  descriptor: LayerParameterDescriptor,
  layer: LayerParameterLayer,
  value: ParameterValue,
  ppi: number,
) {
  const item = parameterById(hostFromLayer(layer), descriptor.semanticId ?? descriptor.key);
  if (!item) return descriptor.write(layer, value);
  return item.write(layer, layer.state, fromCanonical(item, value, ppi));
}

export { parameterValuesEqual };
