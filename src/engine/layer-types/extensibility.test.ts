import { createShapeLayer } from '../layers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadWithZod } from '../schema/zodLoad';
import { z } from 'zod';
import {
  findLayerModule,
  inspectLayerRecord,
  restoreLayerFrom,
  savedLayerFrom,
  layerDefinition,
  registerLayerModule,
  unregisterLayerModule,
  type ErasedLayerModule,
} from './registry';
import { makeAppSettingsFile, parseAppSettingsFile } from '../persistence/settingsFile';
import { defaultShortcutBindings } from '../../shortcuts';
import type { SavedAppSettings } from '../persistence/db';

function probeModule(kindId = 'rin.layer.probe'): ErasedLayerModule {
  const loadDefaults = { gain: 1, label: 'probe' };
  const schema = z.object({ gain: z.number(), label: z.string() });
  return {
    type: 'probe',
    kindId,
    revision: 1,
    create: (name) => ({ id: 'probe', type: 'raster', name }) as never,
    initialState: () => ({ ...loadDefaults }),
    cloneState: (state) => structuredClone(state),
    loadState: (raw) => loadWithZod(schema, loadDefaults, raw),
    encodeState: (state) => state,
    enumerateLayerIds: () => [],
    enumerateAssetIds: () => [],
    enumerateContentAssetIds: () => [],
    definition: {} as never,
  };
}

function settings(): SavedAppSettings {
  return {
    tools: [{ id: 'select', kind: 'lasso', name: '選択', sizeMm: 1, color: '#112233' }],
    toolLayout: [{ type: 'tool', toolId: 'select' }],
    toolStacks: [],
    activeToolId: 'select',
    penColor: '#112233',
    penSizeMm: 1,
    colorHistory: ['#112233'],
    timelapseEnabled: false,
    showEffectRangeGuides: true,
    shortcuts: defaultShortcutBindings(),
  };
}

describe('module extensibility', () => {
  afterEach(() => unregisterLayerModule('rin.layer.probe'));

  it('loads a newly registered layer from owned state without a central migration', () => {
    registerLayerModule(probeModule());
    const loaded = findLayerModule('rin.layer.probe')!.loadState({ gain: 4 });
    expect(loaded).toEqual({
      status: 'ok',
      value: { gain: 4, label: 'probe' },
    });
  });

  it('does not reinterpret old missing keys when create defaults later change', () => {
    const loadDefaults = { gain: 1 };
    const schema = z.object({ gain: z.number() });
    const old = loadWithZod(schema, loadDefaults, {});
    const newCreateDefaults = { gain: 9 };
    const stillOld = loadWithZod(schema, loadDefaults, {});
    expect(old).toEqual({ status: 'ok', value: { gain: 1 } });
    expect(stillOld).toEqual({ status: 'ok', value: { gain: 1 } });
    expect(newCreateDefaults.gain).toBe(9);
  });

  it('keeps unknown kinds as unsupported instead of dropping them', () => {
    const result = inspectLayerRecord({
      id: 'x',
      type: 'future-kind',
      kindId: 'rin.layer.future',
      revision: 1,
      common: {
        name: 'future',
        opacity: 1,
        blend: 'source-over',
        visible: true,
        parentId: null,
        childIds: [],
      },
      state: { hello: true },
    });
    expect(result.status).toBe('unsupported');
  });

  it('round-trips app settings after adding a namespaced field via makeAppSettingsFile', () => {
    const file = makeAppSettingsFile(settings());
    expect(parseAppSettingsFile(file).showEffectRangeGuides).toBe(true);
  });
});

describe('layer revisions', () => {
  const env = { artboard: { w: 100, h: 100 } };
  async function record() {
    return savedLayerFrom(createShapeLayer('line', {
      kind: 'line', x1: 1, y1: 2, x2: 10, y2: 20, color: '#123456', strokeWidth: 1,
    }), env);
  }

  it('uses the same revision check for inspection and runtime restore', async () => {
    const source = await record();
    source.revision = 999;
    expect(inspectLayerRecord(source).status).toBe('unsupported');
    expect(await restoreLayerFrom(source, env)).toBeNull();
    source.revision = 0;
    expect(inspectLayerRecord(source).status).toBe('invalid');
    expect(await restoreLayerFrom(source, env)).toBeNull();
  });

  it('migrates older state inside the module and validates the result', async () => {
    const source = await record();
    const definition = layerDefinition('shape');
    const mod = findLayerModule('shape')!;
    const oldRevision = mod.revision;
    mod.revision = 2;
    const migrate = vi.fn((raw: unknown) => ({ status: 'ok' as const, value: raw }));
    definition.schema.migrate = migrate;
    try {
      expect(inspectLayerRecord(source).status).toBe('ok');
      expect((await restoreLayerFrom(source, env))?.state).toEqual(source.state);
      expect(migrate).toHaveBeenCalledWith(source.state, 1);
      delete definition.schema.migrate;
      expect(inspectLayerRecord(source).status).toBe('unsupported');
    } finally {
      mod.revision = oldRevision;
      delete definition.schema.migrate;
    }
  });
});
