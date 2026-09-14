import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadWithZod } from './zodLoad';

const LOAD_DEFAULTS = {
  brightness: 100,
  extraFlag: false,
  items: [] as string[],
  maybe: null as string | null,
};

const schema = z.object({
  brightness: z.number().finite(),
  extraFlag: z.boolean(),
  items: z.array(z.string()),
  maybe: z.string().nullable(),
});

describe('loadWithZod', () => {
  it('fills only missing keys from load defaults', () => {
    const result = loadWithZod(schema, LOAD_DEFAULTS, { brightness: 40 });
    expect(result).toEqual({
      status: 'ok',
      value: { brightness: 40, extraFlag: false, items: [], maybe: null },
    });
  });

  it('keeps false, 0, empty array, and null as present values', () => {
    const result = loadWithZod(schema, LOAD_DEFAULTS, {
      brightness: 0,
      extraFlag: false,
      items: [],
      maybe: null,
    });
    expect(result).toEqual({
      status: 'ok',
      value: { brightness: 0, extraFlag: false, items: [], maybe: null },
    });
  });

  it('does not use a later create default when loading old missing fields', () => {
    const createDefaults = { ...LOAD_DEFAULTS, brightness: 12 };
    const loaded = loadWithZod(schema, LOAD_DEFAULTS, {});
    const created = loadWithZod(schema, createDefaults, {});
    expect(loaded).toMatchObject({ status: 'ok', value: { brightness: 100 } });
    expect(created).toMatchObject({ status: 'ok', value: { brightness: 12 } });
  });

  it('marks unknown keys as unsupported without stripping them', () => {
    const raw = { brightness: 40, surprise: true };
    const result = loadWithZod(schema, LOAD_DEFAULTS, raw);
    expect(result).toMatchObject({ status: 'unsupported', raw });
  });

  it('marks invalid types as invalid without replacing them', () => {
    const raw = { brightness: 'bright' };
    const result = loadWithZod(schema, LOAD_DEFAULTS, raw);
    expect(result).toMatchObject({ status: 'invalid', raw });
  });
});
