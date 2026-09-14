import type { LayerAddress } from '../../model';
import type { ParameterHost } from '../parameters/host';
import { parameterById } from '../parameters/host';
import { fromCanonical, toCanonical } from '../parameters/codec';
import type { ParameterValue } from '../parameters/types';
import { findLayerModule } from '../layer-types/registry';

export interface ResolveHost {
  address: LayerAddress;
  host: ParameterHost;
  ppi: number;
}

export type ResolvedValue =
  | { status: 'owned'; value: ParameterValue }
  | { status: 'linked'; value: ParameterValue }
  | { status: 'unresolved'; value: ParameterValue };

export interface HostLookup {
  get(address: LayerAddress): ResolveHost | undefined;
}

function addrKey(address: LayerAddress): string {
  return `${address.pageId}:${address.layerId}`;
}

function defaultValue(host: ParameterHost, semanticId: string): ParameterValue {
  const parameter = parameterById(host, semanticId);
  if (!parameter) return null;
  const initial = findLayerModule(host.type)?.initialState() ?? host.state;
  return parameter.read(host, parameter.scope === 'state' ? initial : host.state);
}

export function resolveParameterValue(
  lookup: HostLookup,
  from: ResolveHost,
  semanticId: string,
  targetPpi: number,
  visited = new Set<string>(),
): ResolvedValue {
  const key = `${addrKey(from.address)}:${semanticId}`;
  if (visited.has(key)) return { status: 'unresolved', value: defaultValue(from.host, semanticId) };
  visited.add(key);
  const link = from.host.parameterLink;
  const linked = !!link?.linkedParameterIds.includes(semanticId);
  if (!linked) {
    const parameter = parameterById(from.host, semanticId);
    return { status: 'owned', value: parameter ? parameter.read(from.host, from.host.state) : null };
  }
  const source = lookup.get(link!.source);
  const targetParameter = parameterById(from.host, semanticId);
  if (!source || !targetParameter) {
    return { status: 'unresolved', value: defaultValue(from.host, semanticId) };
  }
  const sourceParameter = parameterById(source.host, semanticId);
  if (!sourceParameter) {
    return { status: 'unresolved', value: defaultValue(from.host, semanticId) };
  }
  const resolved = resolveParameterValue(lookup, source, semanticId, source.ppi, visited);
  const canonical = toCanonical(sourceParameter, resolved.value, source.ppi);
  const value = fromCanonical(targetParameter, canonical, targetPpi);
  return resolved.status === 'unresolved'
    ? { status: 'unresolved', value }
    : { status: 'linked', value };
}
