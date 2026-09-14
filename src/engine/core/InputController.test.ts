// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { InputController } from './InputController';
import type { PaintEngine } from '../PaintEngine';

function pointerEvent(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: 4,
    clientY: 5,
    ...init,
  });
}

describe('direct shape editing gate', () => {
  it('forwards handle editing to the engine', () => {
    const beginShapeEdit = vi.fn(() => true);
    const input = new InputController({
      beginShapeEdit,
    } as unknown as PaintEngine);
    expect(
      input['beginEditableShape'](
        { x: 4, y: 4, pressure: 1 },
        {} as PointerEvent,
      ),
    ).toBe(true);
    expect(beginShapeEdit).toHaveBeenCalledOnce();
  });
});

describe('Command+click layer pick', () => {
  it('runs the cursor action instead of the active tool and does not start shape editing', () => {
    const onDown = vi.fn();
    const cursorDown = vi.fn();
    const beginShapeEdit = vi.fn(() => true);
    const engine = {
      isBusy: () => false,
      finishTextEditing() {},
      view: { clientToArt: (x: number, y: number) => ({ x, y }) },
      activeTool: () => ({
        onDown,
        onMove() {},
        onUp() {},
        startsImmediately: true,
      }),
      cursor: { onDown: cursorDown, onMove() {}, onUp() {}, cancel() {} },
      beginShapeEdit,
      hasShapeEdit: () => false,
    } as unknown as PaintEngine;
    const input = new InputController(engine);
    const area = document.createElement('div');
    area.setPointerCapture = () => undefined;
    area.releasePointerCapture = () => undefined;
    input.attachListeners(area);
    area.dispatchEvent(pointerEvent('pointerdown', { metaKey: true }));
    expect(cursorDown).toHaveBeenCalledOnce();
    expect(onDown).not.toHaveBeenCalled();
    expect(beginShapeEdit).not.toHaveBeenCalled();
    area.dispatchEvent(pointerEvent('pointerup', { metaKey: true }));
    expect(onDown).not.toHaveBeenCalled();
    input.detachListeners();
  });

  it('leaves a plain click to the active tool', () => {
    const onDown = vi.fn();
    const cursorDown = vi.fn();
    const engine = {
      isBusy: () => false,
      finishTextEditing() {},
      view: { clientToArt: (x: number, y: number) => ({ x, y }) },
      activeTool: () => ({
        onDown,
        onMove() {},
        onUp() {},
        startsImmediately: true,
      }),
      cursor: { onDown: cursorDown, onMove() {}, onUp() {}, cancel() {} },
      beginShapeEdit: () => false,
      hasShapeEdit: () => false,
    } as unknown as PaintEngine;
    const input = new InputController(engine);
    const area = document.createElement('div');
    area.setPointerCapture = () => undefined;
    area.releasePointerCapture = () => undefined;
    input.attachListeners(area);
    area.dispatchEvent(pointerEvent('pointerdown', { metaKey: false }));
    expect(onDown).toHaveBeenCalledOnce();
    expect(cursorDown).not.toHaveBeenCalled();
    input.detachListeners();
  });
});

describe('frame-bounded transform input', () => {
  it('uses the latest shape position once per frame, flushes on release, and drops cancelled input', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let serial = 0;
    const raf = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        frames.set(++serial, cb);
        return serial;
      });
    const cancel = vi
      .spyOn(globalThis, 'cancelAnimationFrame')
      .mockImplementation((id) => {
        frames.delete(id);
      });
    const updateShapeEdit = vi.fn();
    const finishShapeEdit = vi.fn();
    const cancelShapeEdit = vi.fn();
    const input = new InputController({
      view: { clientToArt: (x: number, y: number) => ({ x, y }) },
      hasShapeEdit: () => true,
      updateShapeEdit,
      finishShapeEdit,
      cancelShapeEdit,
    } as unknown as PaintEngine);
    try {
      input.activePointer = 1;
      for (let x = 1; x <= 100; x++)
        input['onPointerMove'](pointerEvent('pointermove', { clientX: x }));
      expect(updateShapeEdit).not.toHaveBeenCalled();
      expect(frames.size).toBe(1);
      const frame = [...frames.values()][0];
      frames.clear();
      frame(0);
      expect(updateShapeEdit).toHaveBeenCalledOnce();
      expect(updateShapeEdit.mock.calls[0][0].x).toBe(100);
      input['onPointerMove'](pointerEvent('pointermove', { clientX: 120 }));
      input['onPointerUp'](pointerEvent('pointerup', { clientX: 120 }));
      expect(updateShapeEdit.mock.calls[1][0].x).toBe(120);
      expect(finishShapeEdit).toHaveBeenCalledOnce();
      expect(frames.size).toBe(0);
      input.activePointer = 1;
      input['onPointerMove'](pointerEvent('pointermove', { clientX: 200 }));
      input['onPointerCancel'](pointerEvent('pointercancel', {}));
      expect(updateShapeEdit).toHaveBeenCalledTimes(2);
      expect(cancelShapeEdit).toHaveBeenCalledOnce();
      expect(frames.size).toBe(0);
    } finally {
      raf.mockRestore();
      cancel.mockRestore();
    }
  });

  it('preserves every coalesced pen point while transform tools consume only the latest point', () => {
    const onMove = vi.fn(),
      onUp = vi.fn();
    const tool = { onMove, onUp, latestMoveOnly: false };
    const input = new InputController({
      view: { clientToArt: (x: number, y: number) => ({ x, y }) },
      hasShapeEdit: () => false,
      activeTool: () => tool,
    } as unknown as PaintEngine);
    input.activePointer = 1;
    const event = pointerEvent('pointermove', { clientX: 3 });
    Object.defineProperty(event, 'getCoalescedEvents', {
      value: () =>
        [1, 2, 3].map((clientX) => pointerEvent('pointermove', { clientX })),
    });
    input['onPointerMove'](event);
    expect(onMove.mock.calls.map((call) => call[0].x)).toEqual([1, 2, 3]);
    onMove.mockClear();
    tool.latestMoveOnly = true;
    input['onPointerMove'](event);
    expect(onMove).not.toHaveBeenCalled();
    input['onPointerUp'](pointerEvent('pointerup', { clientX: 3 }));
    expect(onMove.mock.calls.map((call) => call[0].x)).toEqual([3]);
  });
});

it('starts transform manipulation on pointer down only when layer gizmos are enabled', () => {
  const beginShapeEdit = vi.fn(() => true),
    onDown = vi.fn();
  const engine = {
    isBusy: () => false,
    finishTextEditing() {},
    view: { clientToArt: (x: number, y: number) => ({ x, y }) },
    transformEdit: { activeLayer: () => ({ type: 'transform' }) },
    layerGizmosEnabled: () => false,
    activeTool: () => ({
      startsImmediately: true,
      onDown,
    }),
    beginShapeEdit,
  } as unknown as PaintEngine;
  const input = new InputController(engine),
    area = document.createElement('div');
  area.setPointerCapture = () => undefined;
  area.releasePointerCapture = () => undefined;
  input.attachListeners(area);
  try {
    area.dispatchEvent(pointerEvent('pointerdown', {}));
    expect(beginShapeEdit).not.toHaveBeenCalled();
    expect(onDown).toHaveBeenCalledOnce();
  } finally {
    input.detachListeners();
  }
});

describe('tool instance shortcuts', () => {
  it('selects the assigned instance and ignores modifiers, repeat, composition, fields and dialogs', async () => {
    const { useStore } = await import('../../state/store');
    const previous = useStore.getState();
    const selectToolInstance = vi.fn();
    const input = new InputController({ selectToolInstance } as unknown as PaintEngine);
    useStore.setState({ tools: [{ id: 'shortcut-tool', kind: 'pen', name: 'Pen', sizeMm: 1, color: '#000000', shortcut: 'KeyA' }] });
    const area = document.createElement('div');
    input.attachListeners(area);
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyA' }));
      expect(selectToolInstance).toHaveBeenCalledWith('shortcut-tool', 'shortcut');
      selectToolInstance.mockClear();
      for (const extra of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { repeat: true }, { isComposing: true }]) {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyA', ...extra }));
      }
      const field = document.body.appendChild(document.createElement('input'));
      field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyA' }));
      field.remove();
      const dialog = document.body.appendChild(document.createElement('div'));
      dialog.setAttribute('role', 'dialog');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyA' }));
      dialog.remove();
      expect(selectToolInstance).not.toHaveBeenCalled();
    } finally {
      input.detachListeners();
      useStore.setState(previous, true);
    }
  });
});

describe('tool selection shortcut', () => {
  it('deselects the current tool with F by default', async () => {
    const { useStore } = await import('../../state/store');
    const previous = useStore.getState();
    const deselectTool = vi.fn();
    const input = new InputController({ deselectTool } as unknown as PaintEngine);
    const area = document.createElement('div');
    input.attachListeners(area);
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyF' }));
      expect(deselectTool).toHaveBeenCalledOnce();
    } finally {
      input.detachListeners();
      useStore.setState(previous, true);
    }
  });
});
