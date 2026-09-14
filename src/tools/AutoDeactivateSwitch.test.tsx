// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineProvider } from '../components/EngineContext';
import { ToolSettingsHost } from '../components/ToolSettingsHost';
import { defaultTools, useStore } from '../state/store';
import type { PaintEngine } from '../engine/PaintEngine';
import type { ToolKind } from '../registry';

const setAuto = vi.hoisted(() => vi.fn());
const mockEngine = {
  setActiveToolAutoDeactivateAfterUse: setAuto,
  updateActiveToolSettings() {},
} as unknown as PaintEngine;

let container: HTMLDivElement;
let root: Root;
const original = useStore.getState();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setAuto.mockClear();
  const tools = defaultTools();
  useStore.setState({
    tools,
    toolLayout: tools.map((tool) => ({ type: 'tool' as const, toolId: tool.id })),
    toolStacks: [],
    activeToolId: tools[0].id,
    tool: tools[0].kind as ToolKind,
  });
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useStore.setState(original, true);
});

describe('per-tool auto deactivate', () => {
  it('shows the switch on one-shot tools and not on the pen', async () => {
    const cursor = useStore.getState().tools.find((tool) => tool.kind === 'cursor')!;
    useStore.getState().activateTool(cursor.id);
    await act(async () =>
      root.render(
        <EngineProvider engine={mockEngine}>
          <ToolSettingsHost />
        </EngineProvider>,
      ),
    );
    const toggle = container.querySelector('[aria-label="使用後にツール選択を解除"]');
    expect(toggle).not.toBeNull();

    const pen = useStore.getState().tools.find((tool) => tool.kind === 'pen')!;
    useStore.getState().activateTool(pen.id);
    await act(async () =>
      root.render(
        <EngineProvider engine={mockEngine}>
          <ToolSettingsHost />
        </EngineProvider>,
      ),
    );
    expect(container.querySelector('[aria-label="使用後にツール選択を解除"]')).toBeNull();
  });
});
