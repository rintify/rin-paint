import { editorUnit, fromCanonical, toCanonical } from './codec';
import { parametersFor, parameterById, type ParameterHost } from './host';
import { parameterValuesEqual } from './catalog';
import type { ParameterValue, ResolvedParameter } from './types';

export function commonParametersOf(hosts: ParameterHost[], surface: 'single' | 'multi'): ResolvedParameter[] {
  if (!hosts.length) return [];
  const maps = hosts.map(host => {
    const map = new Map<string, ResolvedParameter>();
    for (const item of parametersFor(host, surface)) map.set(item.semanticId, item);
    return map;
  });
  return [...maps[0].values()].filter(item => maps.every(map => map.get(item.semanticId)?.editor.kind === item.editor.kind))
    .map(item => {
      const sameId = maps.every(map => map.get(item.semanticId)?.id === item.id);
      const sameUnit = maps.every(map => editorUnit(map.get(item.semanticId)!)?.kind === editorUnit(item)?.kind);
      return {
        ...item,
        id: sameId ? item.id : item.semanticId,
        read: (common, state) => {
          const host = { ...common, type: (common as ParameterHost).type, state } as ParameterHost;
          const own = parameterById(host, item.semanticId);
          if (!own) return null;
          const value = own.read(common, state);
          return sameId && sameUnit ? value : toCanonical(own, value, 300);
        },
        write: (common, state, value) => {
          const host = { ...common, type: (common as ParameterHost).type, state } as ParameterHost;
          const own = parameterById(host, item.semanticId);
          if (!own) return {};
          const next = sameId && sameUnit ? value : fromCanonical(own, value, 300);
          return own.write(common, state, next);
        },
      };
    });
}

export function sharedParameterValue(
  hosts: ParameterHost[],
  parameter: ResolvedParameter,
  _ppi: number,
): { mixed: boolean; value: ParameterValue } {
  const values = hosts.map(host => {
    const own = parameterById(host, parameter.semanticId) ?? parameter;
    return own.read(host, host.state);
  });
  if (!values.length) return { mixed: true, value: null };
  return values.every(value => parameterValuesEqual(value, values[0]))
    ? { mixed: false, value: values[0] }
    : { mixed: true, value: null };
}

export { parameterValuesEqual };
