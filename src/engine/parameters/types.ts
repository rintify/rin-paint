import type { LayerCommon, LayerType } from '../../model';

export type ParameterValue = number | string | boolean | null;
export type LayerParameterValue = ParameterValue;
export type ParameterSurface = 'single' | 'multi' | 'link';

export type UnitSpec =
  | { kind: 'canvas-mm' }
  | { kind: 'mm' }
  | { kind: 'percent' }
  | { kind: 'degree' }
  | { kind: 'pt' }
  | { kind: 'none'; suffix?: string };

export type OptionSource =
  | { kind: 'static'; options: readonly { value: string; label: string }[] }
  | { kind: 'project-fonts' };

export type ParameterEditor =
  | { kind: 'slider'; min: number; max: number; unit?: UnitSpec; nullable?: boolean }
  | { kind: 'number'; min?: number; max?: number; unit?: UnitSpec; nullable?: boolean }
  | { kind: 'color'; transparent: boolean }
  | { kind: 'select'; options: OptionSource }
  | { kind: 'switch'; trueLabel: string; falseLabel: string };

export interface ParameterValueCodec {
  toCanonical(value: ParameterValue, ppi: number): ParameterValue;
  fromCanonical(value: ParameterValue, ppi: number): ParameterValue;
}

export interface ParameterGroup {
  id: string;
  label: string;
}

export type ParameterValueKind = 'number' | 'string' | 'boolean' | 'color';

export interface ParameterDefinition<S> {
  id: string;
  semanticId: string;
  groupId: string;
  label: string;
  editor: ParameterEditor;
  surfaces: readonly ParameterSurface[];
  /** 値の契約。未指定なら editor から導出する。リンク判定には editor.kind を使わない。 */
  valueKind?: ParameterValueKind;
  unit?: UnitSpec;
  linkable?: boolean;
  multiCompatible?: boolean;
  presentations?: readonly {
    groupId: string;
    label: string;
    editor: ParameterEditor;
    surfaces: readonly ParameterSurface[];
  }[];
  read(state: S): ParameterValue;
  write(state: S, value: ParameterValue): S;
  canonical?: ParameterValueCodec;
}

export interface ParameterCatalog<S> {
  byId: ReadonlyMap<string, ParameterDefinition<S>>;
  bySemanticId: ReadonlyMap<string, ParameterDefinition<S>>;
  groups: readonly ParameterGroup[];
  definitions: readonly ParameterDefinition<S>[];
}

export interface CommonParameterDefinition {
  id: string;
  semanticId: string;
  groupId: string;
  label: string;
  editor: ParameterEditor;
  surfaces: readonly ParameterSurface[];
  valueKind?: ParameterValueKind;
  unit?: UnitSpec;
  linkable?: boolean;
  multiCompatible?: boolean;
  blendOnly?: boolean;
  read(common: LayerCommon): ParameterValue;
  write(common: LayerCommon, value: ParameterValue): Partial<LayerCommon>;
  canonical?: ParameterValueCodec;
}

export interface ResolvedParameter {
  id: string;
  semanticId: string;
  groupId: string;
  label: string;
  editor: ParameterEditor;
  surfaces: readonly ParameterSurface[];
  valueKind: ParameterValueKind;
  unit?: UnitSpec;
  linkable: boolean;
  multiCompatible: boolean;
  scope: 'common' | 'state';
  type?: LayerType;
  read(common: LayerCommon, state: unknown): ParameterValue;
  write(common: LayerCommon, state: unknown, value: ParameterValue): {
    name?: string;
    opacity?: number;
    blend?: import('../../model').BlendMode;
    visible?: boolean;
    parameterLink?: import('../../model').LayerParameterLink | null;
    state?: unknown;
  };
  canonical?: ParameterValueCodec;
}
