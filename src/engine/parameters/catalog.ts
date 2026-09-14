import type {
  CommonParameterDefinition,
  ParameterCatalog,
  ParameterDefinition,
  ParameterEditor,
  ParameterGroup,
  ParameterValue,
  ParameterValueKind,
  ResolvedParameter,
  UnitSpec,
} from './types';

export function valueKindOf(editor: ParameterEditor): ParameterValueKind {
  if (editor.kind === 'color') return 'color';
  if (editor.kind === 'switch') return 'boolean';
  if (editor.kind === 'select') return 'string';
  return 'number';
}

export function unitOf(editor: ParameterEditor): UnitSpec | undefined {
  return editor.kind === 'slider' || editor.kind === 'number' ? editor.unit : undefined;
}

function contractFields(definition: {
  editor: ParameterEditor;
  surfaces: readonly string[];
  valueKind?: ParameterValueKind;
  unit?: UnitSpec;
  linkable?: boolean;
  multiCompatible?: boolean;
}) {
  return {
    valueKind: definition.valueKind ?? valueKindOf(definition.editor),
    unit: definition.unit ?? unitOf(definition.editor),
    linkable: definition.linkable ?? definition.surfaces.includes('link'),
    multiCompatible: definition.multiCompatible ?? definition.surfaces.includes('multi'),
  };
}

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
    ...contractFields(definition),
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
    ...contractFields(definition),
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
