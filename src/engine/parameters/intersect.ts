import { editorUnit, fromCanonical, toCanonical } from './codec';
import { parametersFor, parameterById, type ParameterHost } from './host';
import { parameterValuesEqual } from './catalog';
import type { ParameterValue, ResolvedParameter } from './types';

function sameContract(left: ResolvedParameter, right: ResolvedParameter): boolean {
  return left.valueKind === right.valueKind && (left.unit?.kind ?? editorUnit(left)?.kind) === (right.unit?.kind ?? editorUnit(right)?.kind);
}

export function commonParametersOf(hosts: ParameterHost[], surface: 'single' | 'multi', ppi: number): ResolvedParameter[] {
  if (!hosts.length) return [];
  const maps = hosts.map(host => {
    const map = new Map<string, ResolvedParameter>();
    for (const item of parametersFor(host, surface)) map.set(item.semanticId, item);
    return map;
  });
  return [...maps[0].values()].filter(item => maps.every(map => {
    const other = map.get(item.semanticId);
    return !!other && other.multiCompatible && sameContract(other, item);
  }))
    .map(item => {
      const sameId = maps.every(map => map.get(item.semanticId)?.id === item.id);
      const sameUnit = maps.every(map => sameContract(map.get(item.semanticId)!, item));
      return {
        ...item,
        id: sameId ? item.id : item.semanticId,
        read: (common, state) => {
          const host = { ...common, type: (common as ParameterHost).type, state } as ParameterHost;
          const own = parameterById(host, item.semanticId);
          if (!own) return null;
          const value = own.read(common, state);
          return sameId && sameUnit ? value : toCanonical(own, value, ppi);
        },
        write: (common, state, value) => {
          const host = { ...common, type: (common as ParameterHost).type, state } as ParameterHost;
          const own = parameterById(host, item.semanticId);
          if (!own) return {};
          const next = sameId && sameUnit ? value : fromCanonical(own, value, ppi);
          return own.write(common, state, next);
        },
      };
    });
}

export function sharedParameterValue(
  hosts: ParameterHost[],
  parameter: ResolvedParameter,
  ppi: number,
): { mixed: boolean; value: ParameterValue } {
  const values = hosts.map(host => {
    const own = parameterById(host, parameter.semanticId) ?? parameter;
    const value = own.read(host, host.state);
    const sameUnit = (own.unit?.kind ?? editorUnit(own)?.kind) === (parameter.unit?.kind ?? editorUnit(parameter)?.kind)
      && own.id === parameter.id;
    return sameUnit ? value : toCanonical(own, value, ppi);
  });
  if (!values.length) return { mixed: true, value: null };
  return values.every(value => parameterValuesEqual(value, values[0]))
    ? { mixed: false, value: values[0] }
    : { mixed: true, value: null };
}

export { parameterValuesEqual };
