import type { ToolInstance, ToolLayoutItem, ToolStack } from '../model';

export function normalizeToolLayout(
  tools: ToolInstance[],
  layout: ToolLayoutItem[],
  stacks: ToolStack[],
) {
  const validTools = new Set(tools.map((tool) => tool.id));
  const cleanedStacks = stacks.map((stack) => ({
    ...stack,
    toolIds: stack.toolIds.filter((id) => validTools.has(id)),
  }));
  const singleton = new Map(
    cleanedStacks
      .filter((stack) => stack.toolIds.length === 1)
      .map((stack) => [stack.id, stack.toolIds[0]]),
  );
  layout = layout.flatMap((item) =>
    item.type === 'stack' && singleton.has(item.stackId)
      ? [{ type: 'tool' as const, toolId: singleton.get(item.stackId)! }]
      : [item],
  );
  const nextStacks = cleanedStacks.filter((stack) => stack.toolIds.length >= 2);
  const stacked = new Set(nextStacks.flatMap((stack) => stack.toolIds));
  const validStacks = new Set(nextStacks.map((stack) => stack.id));
  const seenTools = new Set<string>();
  const seenStacks = new Set<string>();
  const nextLayout: ToolLayoutItem[] = [];
  for (const item of layout) {
    if (item.type === 'tool') {
      if (validTools.has(item.toolId) && !stacked.has(item.toolId) && !seenTools.has(item.toolId)) {
        seenTools.add(item.toolId);
        nextLayout.push(item);
      }
    } else if (validStacks.has(item.stackId) && !seenStacks.has(item.stackId)) {
      seenStacks.add(item.stackId);
      nextLayout.push(item);
    }
  }
  for (const stack of nextStacks) {
    if (!seenStacks.has(stack.id)) nextLayout.push({ type: 'stack', stackId: stack.id });
  }
  for (const tool of tools) {
    if (!stacked.has(tool.id) && !seenTools.has(tool.id)) {
      nextLayout.push({ type: 'tool', toolId: tool.id });
    }
  }
  return { toolLayout: nextLayout, toolStacks: nextStacks };
}
