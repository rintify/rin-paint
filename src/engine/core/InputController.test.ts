// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultShortcutBindings } from '../../shortcuts';
import { useStore } from '../../state/store';
import type { PaintEngine } from '../PaintEngine';
import { InputController } from './InputController';

function setup() {
  const reset = vi.fn();
  const emit = vi.fn();
  const engine = {
    view: { reset },
    events: { emit },
  } as unknown as PaintEngine;
  const controller = new InputController(engine);
  const area = document.body.appendChild(document.createElement('div'));
  controller.attachListeners(area);
  return { controller, area, reset, emit };
}

afterEach(() => {
  useStore.getState().set({ shortcuts: defaultShortcutBindings() });
  document.body.replaceChildren();
});

describe('InputController shortcuts', () => {
  it('executes edited bindings instead of hard-coded keys', () => {
    useStore.getState().set({ shortcuts: { ...defaultShortcutBindings(), 'view.reset': 'Alt+KeyR' } });
    const { controller, area, reset } = setup();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit0', metaKey: true }));
    expect(reset).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', altKey: true }));
    expect(reset).toHaveBeenCalledOnce();
    controller.detachListeners();
    area.remove();
  });

  it('routes rename and delete through the selection command event', () => {
    const { controller, area, emit } = setup();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', metaKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backspace' }));
    expect(emit).toHaveBeenNthCalledWith(1, 'shortcutCommand', { command: 'rename-selection' });
    expect(emit).toHaveBeenNthCalledWith(2, 'shortcutCommand', { command: 'delete-selection' });
    controller.detachListeners();
    area.remove();
  });
});
