// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  defaultShortcutBindings,
  shortcutDefinitions,
  shortcutFromEvent,
  shortcutIdForEvent,
  validateShortcutBindings,
} from './shortcuts';

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('shortcut registry', () => {
  it('derives the editable list and defaults from one registry', () => {
    const bindings = defaultShortcutBindings();
    expect(Object.keys(bindings)).toHaveLength(shortcutDefinitions.length);
    expect(bindings['selection.rename']).toBe('Mod+Enter');
    expect(bindings['selection.delete']).toBe('Delete');
  });

  it('matches platform modifier shortcuts and delete aliases', () => {
    const bindings = defaultShortcutBindings();
    expect(shortcutIdForEvent(key({ code: 'Enter', metaKey: true }), bindings)).toBe('selection.rename');
    expect(shortcutIdForEvent(key({ code: 'Enter', ctrlKey: true }), bindings)).toBe('selection.rename');
    expect(shortcutIdForEvent(key({ code: 'Backspace' }), bindings)).toBe('selection.delete');
    expect(shortcutIdForEvent(key({ code: 'Delete' }), bindings)).toBe('selection.delete');
  });

  it('uses edited assignments immediately and validates the complete registry', () => {
    const bindings = { ...defaultShortcutBindings(), 'view.reset': 'Alt+KeyR' };
    expect(shortcutFromEvent(key({ code: 'KeyR', altKey: true }))).toBe('Alt+KeyR');
    expect(shortcutIdForEvent(key({ code: 'KeyR', altKey: true }), bindings)).toBe('view.reset');
    expect(validateShortcutBindings(bindings)).toEqual(bindings);
    expect(validateShortcutBindings({ ...bindings, extra: 'KeyA' })).toEqual(bindings);
    expect(() => validateShortcutBindings({ ...bindings, 'view.reset': 'not-a-key' })).toThrow();
  });
});
