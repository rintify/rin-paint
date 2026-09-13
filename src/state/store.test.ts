import { afterEach, describe, expect, it } from 'vitest';
import type { ToolKind } from '../tools/registry';
import { defaultToolSetup, defaultTools, useStore } from './store';

const original = useStore.getState();

afterEach(() => useStore.setState(original, true));

describe('tool management', () => {
  it('provides every tool kind once and groups the shape tools by default', () => {
    const setup = defaultToolSetup();
    expect(setup.tools.map(tool => tool.kind)).toEqual([
      'cursor', 'pen', 'line', 'rect', 'ellipse', 'polygon', 'panelFrame', 'speechBubble', 'fill', 'eyedropper', 'polygonSplit', 'lasso', 'move', 'blur', 'text', 'image',
    ]);
    expect(new Set(setup.tools.map(tool => tool.kind)).size).toBe(16);
    expect(setup.toolStacks).toHaveLength(1);
    expect(setup.toolStacks[0].name).toBe('図形');
    expect(setup.toolStacks[0].toolIds.map(id => setup.tools.find(tool => tool.id === id)?.kind))
      .toEqual(['line', 'rect', 'ellipse', 'polygon', 'panelFrame', 'speechBubble']);
    expect(setup.toolLayout).toContainEqual({ type: 'stack', stackId: setup.toolStacks[0].id });
  });

  it('reorders tools and leaves no active tool when the active one is removed', () => {
    const tools = defaultTools();
    useStore.setState({ ...original, tools, activeToolId: tools[0].id, tool: tools[0].kind as ToolKind });
    useStore.getState().reorderTools(0, 1);
    expect(useStore.getState().tools.map((tool) => tool.id)).toEqual([tools[1].id, tools[0].id, ...tools.slice(2).map(tool => tool.id)]);
    useStore.getState().removeTool(tools[0].id);
    expect(useStore.getState().activeToolId).toBeNull();
  });

  it('allows deleting the final tool', () => {
    const [tool] = defaultTools();
    useStore.setState({ ...original, tools: [tool], activeToolId: tool.id, tool: tool.kind as ToolKind });
    useStore.getState().removeTool(tool.id);
    expect(useStore.getState().tools).toHaveLength(0);
  });

  it('stores text creation settings on each text tool instance', () => {
    useStore.setState({ ...original, tools: defaultTools() });
    useStore.getState().addTool('text');
    const id = useStore.getState().activeToolId;
    useStore.getState().updateActiveToolSettings({ fontId: 'serif', sizePt: 32, direction: 'vertical', horizontalAlign: 'right', verticalAlign: 'bottom', lineHeight: 2 });
    expect(useStore.getState().tools.find(tool => tool.id === id)?.settings).toEqual({
      fontId: 'serif', sizePt: 32, direction: 'vertical', horizontalAlign: 'right', verticalAlign: 'bottom', lineHeight: 2,
    });
  });

  it('creates and automatically dissolves a two-tool stack', () => {
    const tools = defaultTools();
    useStore.setState({ ...original, tools, toolLayout: tools.map(tool => ({ type: 'tool', toolId: tool.id })), toolStacks: [] });
    useStore.getState().createToolStack(tools[0].id, tools[1].id);
    const stack = useStore.getState().toolStacks[0];
    expect(stack.toolIds).toEqual([tools[1].id, tools[0].id]);
    useStore.getState().unstackTool(tools[0].id);
    expect(useStore.getState().toolStacks).toEqual([]);
    expect(useStore.getState().toolLayout.filter(item => item.type === 'tool')).toHaveLength(tools.length);
  });

  it('reorders the unified layout and tools inside a stack', () => {
    const tools = defaultTools();
    const third = { ...tools[0], id: 'third', name: 'third' };
    useStore.setState({ ...original, tools: [...tools, third], toolLayout: [...tools, third].map(tool => ({ type: 'tool' as const, toolId: tool.id })), toolStacks: [] });
    useStore.getState().reorderToolLayout(tools.length, 0);
    expect(useStore.getState().toolLayout[0]).toEqual({ type: 'tool', toolId: 'third' });
    useStore.getState().createToolStack(tools[0].id, tools[1].id);
    const stack = useStore.getState().toolStacks[0];
    useStore.getState().reorderStackTools(stack.id, 0, 1);
    expect(useStore.getState().toolStacks[0].toolIds).toEqual([tools[0].id, tools[1].id]);
  });

  it('persists the aspect-lock switch on a shape tool instance', () => {
    useStore.setState({ ...original, tools: defaultTools() });
    useStore.getState().addTool('rect');
    const id = useStore.getState().activeToolId;
    useStore.getState().updateActiveToolSettings({ constrainAspect: true, strokeJoin: 'miter', cornerRadiusMm: 4.25 });
    expect(useStore.getState().tools.find(tool => tool.id === id)?.settings).toMatchObject({
      paintMode: 'stroke',
      constrainAspect: true,
      strokeJoin: 'miter',
      cornerRadiusMm: 4.25,
    });
  });
});
