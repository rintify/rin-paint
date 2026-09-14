// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { TextEditor } from './TextEditor';
import { EngineProvider } from './EngineContext';
import { useStore } from '../state/store';
import { createTextLayer } from '../engine/layers';
import { newText } from '../engine/text/model';
import type { PaintEngine } from '../engine/PaintEngine';

const original = useStore.getState();
afterEach(() => {
  useStore.setState(original, true);
  vi.restoreAllMocks();
});

function renderEditor(tool: typeof original.tool) {
  const text = { ...newText(10, 20, '#111'), content: 'あ', width: 80, height: 40 };
  const layer = createTextLayer('文字', text, 'text');
  useStore.setState({
    ...original,
    activeLayerId: layer.id,
    textEditingId: null,
    tool,
    activeToolId: tool ? 'cursor' : null,
    layers: [{ ...layer, version: 0, canMergeDown: false, canRemove: true, canTransferShape: false }],
    viewScale: 1,
  });
  const engine = {
    events: { on() {}, off() {} },
    getLayerCanvas: () => null,
    getText: () => text,
    view: { clientToArt: (x: number, y: number) => ({ x, y }) },
  } as unknown as PaintEngine;
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  return { element, root, engine };
}

it('hides transform gizmos while a tool is selected', async () => {
  const { element, root, engine } = renderEditor('cursor');
  try {
    await act(async () =>
      root.render(
        <EngineProvider engine={engine}>
          <TextEditor fitScale={1} />
        </EngineProvider>,
      ),
    );
    const frame = element.querySelector('.text-frame');
    expect(frame?.classList.contains('gizmo-locked')).toBe(true);
    expect(element.querySelector('.text-resize-handle')).toBeNull();
    expect(element.querySelector('.text-rotate-handle')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
});

it('shows transform gizmos when no tool is selected', async () => {
  const { element, root, engine } = renderEditor(null);
  try {
    await act(async () =>
      root.render(
        <EngineProvider engine={engine}>
          <TextEditor fitScale={1} />
        </EngineProvider>,
      ),
    );
    expect(element.querySelector('.text-frame')?.classList.contains('gizmo-locked')).toBe(false);
    expect(element.querySelectorAll('.text-resize-handle')).toHaveLength(4);
    expect(element.querySelector('.text-rotate-handle')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
});

it('coalesces text frame moves and flushes the latest position before committing', async () => {
  const { element, root, engine } = renderEditor(null);
  let current = engine.getText('text')!;
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  engine.getText = () => current;
  engine.visibleObjectBounds = () => [];
  engine.uiScale = () => 1;
  Object.assign(engine, { artboard: { w: 1000, h: 1000 } });
  engine.updateText = vi.fn((_id, _before, after) => { current = after; });
  try {
    await act(async () => root.render(<EngineProvider engine={engine}><TextEditor fitScale={1} /></EngineProvider>));
    const frame = element.querySelector<HTMLElement>('.text-frame')!;
    frame.setPointerCapture = () => {};
    frame.hasPointerCapture = () => false;
    const pointer = (type: string, x: number) => frame.dispatchEvent(new PointerEvent(type,
      { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: 100 }));
    await act(async () => { pointer('pointerdown', 100); });
    await act(async () => {
      for (let x = 101; x <= 200; x++) pointer('pointermove', x);
    });
    expect(engine.updateText).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    await act(async () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback(0));
    });
    expect(engine.updateText).toHaveBeenCalledTimes(1);
    expect(current.x).toBe(110);
    await act(async () => {
      pointer('pointermove', 250);
      pointer('pointerup', 250);
    });
    expect(current.x).toBe(160);
    expect(engine.updateText).toHaveBeenLastCalledWith('text', expect.anything(), expect.objectContaining({ x: 160 }));
    expect(frames.size).toBe(0);
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
});
