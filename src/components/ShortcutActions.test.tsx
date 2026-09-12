// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineEvents } from '../engine/events';
import type { PaintEngine } from '../engine/PaintEngine';
import { useStore } from '../state/store';
import { EngineProvider } from './EngineContext';
import { ShortcutActions } from './ShortcutActions';

let root: Root;
let host: HTMLDivElement;
const original = useStore.getState();
const renameTool = vi.fn(() => true);
const dissolve = vi.fn();
const engine = {
  events: new EngineEvents(),
  renameToolInstance: renameTool,
  renameLayer: vi.fn(() => true),
  renameToolStack: vi.fn(() => true),
  removeLayer: vi.fn(),
  removeToolInstance: vi.fn(),
  dissolveToolStack: dissolve,
} as unknown as PaintEngine;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  renameTool.mockClear();
  dissolve.mockClear();
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root.render(<EngineProvider engine={engine}><ShortcutActions /></EngineProvider>));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useStore.setState(original, true);
});

describe('ShortcutActions', () => {
  it('renames the selected tool through the shared name dialog', async () => {
    const tool = useStore.getState().tools[0];
    useStore.getState().set({ shortcutTarget: { type: 'tool', id: tool.id } });
    await act(async () => engine.events.emit('shortcutCommand', { command: 'rename-selection' }));
    const input = document.querySelector('[role="dialog"] input') as HTMLInputElement;
    expect(input.value).toBe(tool.name);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '新しいツール名');
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(renameTool).toHaveBeenCalledWith(tool.id, '新しいツール名');
  });

  it('dissolves the selected group on delete', async () => {
    const stack = useStore.getState().toolStacks[0];
    useStore.getState().set({ shortcutTarget: { type: 'stack', id: stack.id } });
    await act(async () => engine.events.emit('shortcutCommand', { command: 'delete-selection' }));
    expect(dissolve).toHaveBeenCalledWith(stack.id);
  });
});
