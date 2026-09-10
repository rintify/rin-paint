import { afterEach, describe, expect, it } from 'vitest';
import { defaultTools, useStore } from './store';

const original = useStore.getState();

afterEach(() => useStore.setState(original, true));

describe('tool management', () => {
  it('reorders tools and follows an active tool when it is removed', () => {
    const tools = defaultTools();
    useStore.setState({ ...original, tools, activeToolId: tools[0].id, tool: tools[0].kind });
    useStore.getState().reorderTools(0, 1);
    expect(useStore.getState().tools.map((tool) => tool.id)).toEqual([tools[1].id, tools[0].id]);
    useStore.getState().removeTool(tools[0].id);
    expect(useStore.getState().activeToolId).toBe(tools[1].id);
  });

  it('does not delete the final tool', () => {
    const [tool] = defaultTools();
    useStore.setState({ ...original, tools: [tool], activeToolId: tool.id, tool: tool.kind });
    useStore.getState().removeTool(tool.id);
    expect(useStore.getState().tools).toHaveLength(1);
  });
});
