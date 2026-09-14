import type { ParameterDefinition, ParameterSurface, ParameterValue } from './types';

const SURFACES = ['single', 'multi', 'link'] as const satisfies readonly ParameterSurface[];

export function snapParameter<S>(write: (state: S, enabled: boolean) => S): ParameterDefinition<S> {
  return {
    id: 'snapEnabled',
    semanticId: 'interaction.snap',
    groupId: 'interaction',
    label: 'スナップ',
    editor: { kind: 'switch', trueLabel: 'ON', falseLabel: 'OFF' },
    surfaces: SURFACES,
    valueKind: 'boolean',
    read: (state) => Boolean((state as { snapEnabled?: boolean }).snapEnabled !== false),
    write: (state, value) => write(state, Boolean(value)),
  };
}

export function rotationDegreesParameter<S>(args: {
  read: (state: S) => number;
  write: (state: S, degrees: number) => S;
}): ParameterDefinition<S> {
  return {
    id: 'rotation',
    semanticId: 'transform.rotation',
    groupId: 'transform',
    label: '回転',
    editor: { kind: 'number', min: -3600, max: 3600, unit: { kind: 'degree' } },
    surfaces: SURFACES,
    valueKind: 'number',
    unit: { kind: 'degree' },
    read: args.read,
    write: (state, value) => args.write(state, Number(value)),
  };
}

export function appearanceColorParameter<S>(args: {
  id?: string;
  transparent: boolean;
  surfaces?: readonly ParameterSurface[];
  read: (state: S) => ParameterValue;
  write: (state: S, value: string) => S;
}): ParameterDefinition<S> {
  return {
    id: args.id ?? 'color',
    semanticId: 'appearance.color',
    groupId: 'appearance',
    label: '色',
    editor: { kind: 'color', transparent: args.transparent },
    surfaces: args.surfaces ?? SURFACES,
    valueKind: 'color',
    read: args.read,
    write: (state, value) => args.write(state, String(value)),
  };
}

export function canvasMmNumberParameter<S>(args: {
  id: string;
  semanticId: string;
  groupId?: string;
  label: string;
  nullable?: boolean;
  min?: number;
  read: (state: S) => ParameterValue;
  write: (state: S, value: ParameterValue) => S;
}): ParameterDefinition<S> {
  return {
    id: args.id,
    semanticId: args.semanticId,
    groupId: args.groupId ?? 'frame',
    label: args.label,
    editor: {
      kind: 'number',
      unit: { kind: 'canvas-mm' },
      nullable: args.nullable,
      min: args.min,
    },
    surfaces: SURFACES,
    valueKind: 'number',
    unit: { kind: 'canvas-mm' },
    read: args.read,
    write: args.write,
  };
}
