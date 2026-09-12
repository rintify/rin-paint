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

describe('InputController eyedropper sampling', () => {
  it('requests either the active layer or the final composite', () => {
    const samplePixel = vi.fn(() => new Uint8ClampedArray([18, 52, 86, 255]));
    const engine = {
      getActiveLayerId: () => 'active',
      layerById: () => ({}),
      compositor: { samplePixel },
    } as unknown as PaintEngine;
    const controller = new InputController(engine);

    expect(controller.getPixel(4, 7, 'active-layer')).toBe('#123456');
    expect(samplePixel).toHaveBeenNthCalledWith(1, 4, 7, 'active');
    expect(controller.getPixel(4, 7, 'final-color')).toBe('#123456');
    expect(samplePixel).toHaveBeenNthCalledWith(2, 4, 7, null);
  });
});
