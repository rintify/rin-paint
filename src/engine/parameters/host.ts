import type { LayerCommon, LayerType } from '../../model';
import type { LayerRecord } from '../layer-types/definition';
import { kindCatalog, layerDefinition, resolvedParameters } from '../layer-types/registry';
import { resolveCommonParameter, resolveKindParameter } from './catalog';
import { decodeGeometryState } from '../persistence/geometryState';
import { commonForLayer } from './common';
import type { ParameterSurface, ResolvedParameter } from './types';

export type ParameterHost = LayerCommon & { type: LayerType; state: unknown };

export function hostFromLayer(layer: ParameterHost): ParameterHost {
  return layer;
}

export function hostFromRecord(record: LayerRecord, ppi?: number): ParameterHost {
  return {
    id: record.id,
    type: record.type,
    ...record.common,
    state: record.geometryUnit === 'mm' && ppi
      ? decodeGeometryState(record.type, record.state, ppi)
      : record.state,
  };
}

export function parametersFor(
  host: ParameterHost,
  surface?: ParameterSurface,
): ResolvedParameter[] {
  return resolvedParameters(host).filter(item => !surface || item.surfaces.includes(surface));
}

export function parameterById(host: ParameterHost, id: string): ResolvedParameter | undefined {
  const common = commonForLayer(layerDefinition(host.type).info.supportsBlend)
    .find(item => item.id === id || item.semanticId === id);
  if (common) return resolveCommonParameter(common);
  const catalog = kindCatalog(host);
  const definition = catalog.byId.get(id) ?? catalog.bySemanticId.get(id);
  return definition ? resolveKindParameter(definition, host.type) : undefined;
}

export function linkableParameters(host: ParameterHost): Map<string, ResolvedParameter> {
  const map = new Map<string, ResolvedParameter>();
  for (const item of parametersFor(host, 'link')) map.set(item.semanticId, item);
  return map;
}

export function catalogSize(host: ParameterHost): number {
  return 3 + kindCatalog(host).definitions.length;
}

export { layerDefinition };
