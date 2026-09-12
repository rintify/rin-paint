import type {
  CommonParameterDefinition,
  ParameterCatalog,
  ParameterDefinition,
  ParameterGroup,
  ParameterValue,
  ResolvedParameter,
} from './types';

export function buildCatalog<S>(
  groups: readonly ParameterGroup[],
  definitions: readonly ParameterDefinition<S>[],
): ParameterCatalog<S> {
  const byId = new Map<string, ParameterDefinition<S>>();
  const bySemanticId = new Map<string, ParameterDefinition<S>>();
  for (const definition of definitions) {
    if (byId.has(definition.id)) throw new Error(`Duplicate parameter id: ${definition.id}`);
    byId.set(definition.id, definition);
    if (!bySemanticId.has(definition.semanticId)) bySemanticId.set(definition.semanticId, definition);
  }
  return { byId, bySemanticId, groups, definitions };
}

export function emptyCatalog<S>(): ParameterCatalog<S> {
  return buildCatalog([], []);
}

export function resolveKindParameter<S>(definition: ParameterDefinition<S>, type: ResolvedParameter['type']): ResolvedParameter {
  return {
    id: definition.id,
    semanticId: definition.semanticId,
    groupId: definition.groupId,
    label: definition.label,
    editor: definition.editor,
    surfaces: definition.surfaces,
    scope: 'state',
    type,
    read: (_common, state) => definition.read(state as S),
    write: (_common, state, value) => ({ state: definition.write(state as S, value) }),
    canonical: definition.canonical,
  };
}

export function resolveCommonParameter(definition: CommonParameterDefinition): ResolvedParameter {
  return {
    id: definition.id,
    semanticId: definition.semanticId,
    groupId: definition.groupId,
    label: definition.label,
    editor: definition.editor,
    surfaces: definition.surfaces,
    scope: 'common',
    read: common => definition.read(common),
    write: (common, _state, value) => definition.write(common, value),
    canonical: definition.canonical,
  };
}

export function parameterValuesEqual(a: ParameterValue, b: ParameterValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  return Object.is(a, b);
}

export type { ParameterCatalog, ParameterDefinition, ParameterGroup };
