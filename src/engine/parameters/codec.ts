import { mmToPx, pxToMm } from '../units';
import type { ParameterValue, ParameterValueCodec, ResolvedParameter } from './types';

export const pageMmCodec: ParameterValueCodec = {
  toCanonical: (value, ppi) => typeof value === 'number' ? pxToMm(value, ppi) : value,
  fromCanonical: (value, ppi) => typeof value === 'number' ? mmToPx(value, ppi) : value,
};

export function editorUnit(parameter: ResolvedParameter) {
  return parameter.editor.kind === 'slider' || parameter.editor.kind === 'number'
    ? parameter.editor.unit
    : undefined;
}

export function toCanonical(parameter: ResolvedParameter, value: ParameterValue, ppi: number): ParameterValue {
  if (parameter.canonical) return parameter.canonical.toCanonical(value, ppi);
  return editorUnit(parameter)?.kind === 'page-mm' ? pageMmCodec.toCanonical(value, ppi) : value;
}

export function fromCanonical(parameter: ResolvedParameter, value: ParameterValue, ppi: number): ParameterValue {
  if (parameter.canonical) return parameter.canonical.fromCanonical(value, ppi);
  return editorUnit(parameter)?.kind === 'page-mm' ? pageMmCodec.fromCanonical(value, ppi) : value;
}

export function editorAllowsNull(parameter: ResolvedParameter): boolean {
  return (parameter.editor.kind === 'number' || parameter.editor.kind === 'slider')
    && parameter.editor.nullable === true;
}
