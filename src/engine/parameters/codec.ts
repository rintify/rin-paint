import type { ParameterValue, ResolvedParameter } from './types';

export function editorUnit(parameter: ResolvedParameter) {
  return parameter.editor.kind === 'slider' || parameter.editor.kind === 'number'
    ? parameter.editor.unit
    : undefined;
}

export function toCanonical(parameter: ResolvedParameter, value: ParameterValue, ppi: number): ParameterValue {
  if (parameter.canonical) return parameter.canonical.toCanonical(value, ppi);
  return value;
}

export function fromCanonical(parameter: ResolvedParameter, value: ParameterValue, ppi: number): ParameterValue {
  if (parameter.canonical) return parameter.canonical.fromCanonical(value, ppi);
  return value;
}

export function editorAllowsNull(parameter: ResolvedParameter): boolean {
  return (parameter.editor.kind === 'number' || parameter.editor.kind === 'slider')
    && parameter.editor.nullable === true;
}
