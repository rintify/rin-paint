// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { InputController } from './InputController';
import type { PaintEngine } from '../PaintEngine';

function pointerEvent(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: 4, clientY: 5, ...init });
}

describe('direct shape editing gate', () => {
  it('skips handle and move editing when the active tool forbids it', () => {
    const beginShapeEdit = vi.fn(() => true);
    const input = new InputController({
      beginShapeEdit,
      activeTool: () => ({ allowsDirectShapeEdit: false }),
    } as unknown as PaintEngine);
    expect(input['beginEditableShape']({ x: 4, y: 4, pressure: 1 }, {} as PointerEvent)).toBe(false);
    expect(beginShapeEdit).not.toHaveBeenCalled();
  });

  it('starts handle and move editing for tools that leave the capability on', () => {
    const beginShapeEdit = vi.fn(() => true);
    const input = new InputController({
      beginShapeEdit,
      activeTool: () => ({}),
    } as unknown as PaintEngine);
    expect(input['beginEditableShape']({ x: 4, y: 4, pressure: 1 }, {} as PointerEvent)).toBe(true);
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
      activeTool: () => ({ onDown, onMove() {}, onUp() {}, allowsDirectShapeEdit: true, startsImmediately: true }),
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
      activeTool: () => ({ onDown, onMove() {}, onUp() {}, startsImmediately: true }),
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
