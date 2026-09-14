// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { ToolPicker } from './ToolPicker';
import { EngineProvider } from './EngineContext';
import { useStore, defaultTools } from '../state/store';
import type { PaintEngine } from '../engine/PaintEngine';

const rename = vi.hoisted(() => vi.fn(() => true));
const mockEngine = vi.hoisted(() => ({
  renameToolInstance: rename,
  unstackTool: (id: string, index?: number) => useStore.getState().unstackTool(id, index),
  selectToolInstance: (id: string) => useStore.getState().activateTool(id),
  removeToolInstance: (id: string) => useStore.getState().removeTool(id),
  dissolveToolStack: (id: string) => useStore.getState().dissolveToolStack(id),
  renameToolStack: (id: string, name: string) => useStore.getState().renameToolStack(id, name),
  moveToolToStack: (...args: Parameters<ReturnType<typeof useStore.getState>['moveToolToStack']>) =>
    useStore.getState().moveToolToStack(...args),
  createToolStack: (...args: Parameters<ReturnType<typeof useStore.getState>['createToolStack']>) =>
    useStore.getState().createToolStack(...args),
  reorderStackTools: (...args: Parameters<ReturnType<typeof useStore.getState>['reorderStackTools']>) =>
    useStore.getState().reorderStackTools(...args),
  reorderToolLayout: (...args: Parameters<ReturnType<typeof useStore.getState>['reorderToolLayout']>) =>
    useStore.getState().reorderToolLayout(...args),
  addToolInstance: (kind: Parameters<ReturnType<typeof useStore.getState>['addTool']>[0]) =>
    useStore.getState().addTool(kind),
})) as unknown as PaintEngine;

let root: Root;
let host: HTMLDivElement;
const original = useStore.getState();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const tools = defaultTools().slice(0, 2);
  useStore.setState({ tools, toolStacks: [], toolLayout: tools.map(t => ({ type: 'tool', toolId: t.id })) });
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  rename.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useStore.setState(original, true);
});
async function renderPicker() {
  await act(async () =>
    root.render(
      <EngineProvider engine={mockEngine}>
        <ToolPicker />
      </EngineProvider>,
    ));
}
async function click(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => el!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}
it('keeps the name field focused after choosing rename from the actual menu', async () => {
  await renderPicker();
  await click(document.querySelector('[aria-label="ツールを管理"]'));
  await click(document.querySelector('.manage-tool-card-actions button'));
  await click([...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent === '名称変更')!);
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 300));
  });
  const input = document.querySelector('.manage-tool-card input');
  expect(input).not.toBeNull();
  expect(document.activeElement).toBe(input);
  expect(rename).not.toHaveBeenCalled();
});

it('removes a tool from its group when dropped on unused management space', async () => {
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: () => ({ cancel() {} }),
  });
  const tools = useStore.getState().tools;
  useStore.getState().createToolStack(tools[0].id, tools[1].id);
  await renderPicker();
  await click(document.querySelector('[aria-label="ツールを管理"]'));
  await click(document.querySelector('.manage-stack-tile'));
  const member = document.querySelector('[data-stack-tool]') as HTMLElement;
  const id = member.dataset.toolId!;
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.querySelector('.manage-tools-content'));
  await act(async () =>
    member.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 2, clientX: 10, clientY: 10 })));
  await act(async () =>
    member.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 2, clientX: 100, clientY: 200 })));
  expect(document.querySelector('.tool-unstack-drop-guide')).not.toBeNull();
  await act(async () =>
    member.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2, clientX: 100, clientY: 200 })));
  expect(useStore.getState().toolLayout).toContainEqual({ type: 'tool', toolId: id });
  expect(useStore.getState().toolStacks).toHaveLength(0);
  expect(useStore.getState().tools).toHaveLength(2);
  expect(document.querySelector('[data-testid="DragIndicatorIcon"]')).toBeNull();
  vi.restoreAllMocks();
});

it('lifts a tool after the drag threshold and follows the pointer', async () => {
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);
  await renderPicker();
  await click(document.querySelector('[aria-label="ツールを管理"]'));
  const card = document.querySelector('.manage-tool-card')!;
  await act(async () =>
    card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10 })));
  await act(async () =>
    card.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 40, clientY: 50 })));
  const lifted = document.querySelector('.manage-tool-floating') as HTMLElement;
  expect(lifted).not.toBeNull();
  expect(lifted.style.left).toBe('30px');
  expect(lifted.style.top).toBe('40px');
  await act(async () => card.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })));
  expect(document.querySelector('.manage-tool-floating')).toBeNull();
  vi.restoreAllMocks();
});

it('dismisses an expanded group by pressing outside it', async () => {
  const tools = useStore.getState().tools;
  useStore.getState().createToolStack(tools[0].id, tools[1].id);
  await renderPicker();
  await click(document.querySelector('[aria-label="ツールを管理"]'));
  await click(document.querySelector('.manage-stack-tile'));
  expect(document.querySelector('.manage-stack-expanded')).not.toBeNull();
  await act(async () => {
    document.querySelector('.manage-tools-content')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 260));
  });
  expect(document.querySelector('.manage-stack-expanded')).toBeNull();
});

it('opens hover tools without a modal backdrop and closes after leaving both surfaces', async () => {
  const tools = useStore.getState().tools;
  useStore.getState().createToolStack(tools[0].id, tools[1].id);
  await renderPicker();
  const anchor = document.querySelector('.tool-stack-button')!;
  await act(async () =>
    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })));
  const popup = document.querySelector('.tool-stack-popover')!;
  expect(popup).not.toBeNull();
  expect(document.querySelector('.MuiBackdrop-root')).toBeNull();
  await act(async () => {
    anchor.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: popup }));
    popup.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: anchor }));
    await new Promise(resolve => setTimeout(resolve, 160));
  });
  expect(document.querySelector('.tool-stack-popover')).not.toBeNull();
  await act(async () => {
    popup.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    await new Promise(resolve => setTimeout(resolve, 160));
  });
  expect(document.querySelector('.tool-stack-popover')).toBeNull();
});

it('assigns from the tool menu, confirms conflicts, and removes the assignment', async () => {
  const [first, second] = useStore.getState().tools;
  useStore.getState().assignToolShortcut(second.id, 'KeyA');
  await renderPicker();
  await click(document.querySelector('[aria-label="ツールを管理"]'));
  const openAssignment = async () => {
    await click(document.querySelector('.manage-tool-card-actions button'));
    await click([...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent === 'ショートカット割り当て')!);
  };
  const button = (label: string) => [...document.querySelectorAll('button')].find(el => el.textContent === label)!;
  await openAssignment();
  expect(document.querySelector('select')).toBeNull();
  await act(async () => document.querySelector('[role="combobox"]')!.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, code: 'KeyA', key: 'a' }),
  ));
  await click(button('保存'));
  expect(document.body.textContent).toContain('割り当てを上書きしますか？');
  expect(useStore.getState().tools.find(t => t.id === first.id)?.shortcut).toBeUndefined();
  await click(button('上書きする'));
  expect(useStore.getState().tools.find(t => t.id === first.id)?.shortcut).toBe('KeyA');
  expect(useStore.getState().tools.find(t => t.id === second.id)?.shortcut).toBeUndefined();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
  await openAssignment();
  await click(button('割り当てを解除'));
  await click(button('保存'));
  expect(useStore.getState().tools.find(t => t.id === first.id)?.shortcut).toBeUndefined();
});
