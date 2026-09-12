import { describe, expect, it, vi } from 'vitest';
import { InputController } from './InputController';
import type { PaintEngine } from '../PaintEngine';

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
