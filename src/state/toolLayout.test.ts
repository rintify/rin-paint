import { describe, expect, it } from 'vitest';
import { normalizeToolLayout } from './toolLayout';
import type { ToolInstance, ToolLayoutItem, ToolStack } from '../model';

function tool(id: string): ToolInstance {
  return { id, kind: 'pen', name: id, sizeMm: 1.19, color: '#000' };
}

describe('normalizeToolLayout', () => {
  it('drops missing tools and keeps valid layout order', () => {
    const tools = [tool('a'), tool('b')];
    const layout: ToolLayoutItem[] = [
      { type: 'tool', toolId: 'b' },
      { type: 'tool', toolId: 'gone' },
      { type: 'tool', toolId: 'a' },
    ];
    const result = normalizeToolLayout(tools, layout, []);
    expect(result.toolLayout).toEqual([
      { type: 'tool', toolId: 'b' },
      { type: 'tool', toolId: 'a' },
    ]);
    expect(result.toolStacks).toEqual([]);
  });

  it('collapses singleton stacks into tools', () => {
    const tools = [tool('a'), tool('b')];
    const stacks: ToolStack[] = [{ id: 's1', name: 'S', toolIds: ['a'] }];
    const layout: ToolLayoutItem[] = [
      { type: 'stack', stackId: 's1' },
      { type: 'tool', toolId: 'b' },
    ];
    const result = normalizeToolLayout(tools, layout, stacks);
    expect(result.toolStacks).toEqual([]);
    expect(result.toolLayout).toEqual([
      { type: 'tool', toolId: 'a' },
      { type: 'tool', toolId: 'b' },
    ]);
  });

  it('appends tools missing from layout', () => {
    const tools = [tool('a'), tool('b'), tool('c')];
    const result = normalizeToolLayout(tools, [{ type: 'tool', toolId: 'a' }], []);
    expect(result.toolLayout.map((item) => (item.type === 'tool' ? item.toolId : item.stackId))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
