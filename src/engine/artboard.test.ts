import { describe, expect, it, vi } from 'vitest';
import { Artboard } from './artboard';
import { EngineEvents } from './events';
import { MAX_ART_SIZE, MIN_ART_SIZE } from '../model/canvas';

describe('Artboard', () => {
  it('clamps resize to min/max', () => {
    const art = new Artboard();
    art.resize(1, 1);
    expect(art.w).toBe(MIN_ART_SIZE);
    expect(art.h).toBe(MIN_ART_SIZE);
    art.resize(99999, 99999);
    expect(art.w).toBe(MAX_ART_SIZE);
    expect(art.h).toBe(MAX_ART_SIZE);
  });
});

describe('EngineEvents', () => {
  it('delivers typed payloads and supports off', () => {
    const events = new EngineEvents();
    const seen: { command: 'rename-selection' | 'delete-selection' }[] = [];
    const handler = (payload: { command: 'rename-selection' | 'delete-selection' }) => seen.push(payload);
    events.on('shortcutCommand', handler);
    events.emit('shortcutCommand', { command: 'rename-selection' });
    expect(seen).toEqual([{ command: 'rename-selection' }]);
    events.off('shortcutCommand', handler);
    events.emit('shortcutCommand', { command: 'delete-selection' });
    expect(seen).toHaveLength(1);
  });

  it('emits void events without payload', () => {
    const events = new EngineEvents();
    const fn = vi.fn();
    events.on('projectReset', fn);
    events.emit('projectReset');
    expect(fn).toHaveBeenCalledOnce();
  });
});
