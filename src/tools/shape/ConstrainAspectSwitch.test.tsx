// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineProvider } from '../../components/EngineContext';
import { defaultTools, useStore } from '../../state/store';
import type { PaintEngine } from '../../engine/PaintEngine';
import type { ToolKind } from '../registry';
import { EllipseSettingsPanel } from '../ellipse/Panel';
import { RectSettingsPanel } from '../rect/Panel';

const update = vi.hoisted(() => vi.fn());
const mockEngine = { updateActiveToolSettings: update } as unknown as PaintEngine;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  update.mockClear();
  const tools = defaultTools().filter(tool => tool.kind === 'pen' || tool.kind === 'lasso');
  useStore.setState({ tools, toolLayout: tools.map(tool => ({ type: 'tool' as const, toolId: tool.id })), toolStacks: [], activeToolId: tools[0].id, tool: tools[0].kind as ToolKind });
  useStore.getState().addTool('rect');
  useStore.getState().addTool('ellipse');
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  const tools = defaultTools();
  useStore.setState({ tools, activeToolId: tools[0].id, tool: 'pen' });
});

describe('shape tool aspect lock', () => {
  it('shows square and circle lock switches with accessible labels', async () => {
    const rectTool = useStore.getState().tools.find(tool => tool.kind === 'rect')!;
    useStore.getState().activateTool(rectTool.id);
    await act(async () => root.render(<EngineProvider engine={mockEngine}><RectSettingsPanel /></EngineProvider>));
    expect(container.querySelector('[aria-label="正方形に固定"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="線の角"]')).not.toBeNull();
    expect(container.textContent).toContain('角丸半径');
    const ellipseTool = useStore.getState().tools.find(tool => tool.kind === 'ellipse')!;
    useStore.getState().activateTool(ellipseTool.id);
    await act(async () => root.render(<EngineProvider engine={mockEngine}><EllipseSettingsPanel /></EngineProvider>));
    expect(container.querySelector('[aria-label="正円に固定"]')).not.toBeNull();
  });
});
