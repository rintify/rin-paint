import { DEFAULT_SIZE_MM } from '../engine/units';
import {
  newToolInstanceId,
  newToolStackId,
  type ToolInstance,
  type ToolLayoutItem,
  type ToolStack,
} from '../model/tool';
import {
  defaultToolSettings,
  TOOL_KINDS,
  TOOL_REGISTRY,
  type ToolKind,
} from './registry';

export interface DefaultToolSetup {
  tools: ToolInstance[];
  toolLayout: ToolLayoutItem[];
  toolStacks: ToolStack[];
}

/** 各ツール定義から初回起動用の一覧と図形スタックを組み立てる。 */
export function defaultToolSetup(): DefaultToolSetup {
  const kinds = TOOL_KINDS ?? [];
  const tools = kinds.flatMap((kind) => {
    const descriptor = TOOL_REGISTRY[kind];
    if (!descriptor) return [];
    return {
      id: newToolInstanceId(),
      kind,
      name: descriptor.label,
      sizeMm: descriptor.initialSizeMm ?? DEFAULT_SIZE_MM,
      color: descriptor.initialColor ?? '#222222',
      ...(descriptor.settings || descriptor.autoDeactivateAfterUse
        ? { settings: defaultToolSettings(kind) }
        : {}),
    } satisfies ToolInstance;
  });
  if (!tools.length) return { tools: [], toolLayout: [], toolStacks: [] };
  const shapeTools = tools.filter(
    (tool) => TOOL_REGISTRY?.[tool.kind as ToolKind]?.category === 'shape',
  );
  const shapeStack: ToolStack = {
    id: newToolStackId(),
    name: '図形',
    toolIds: shapeTools.map((tool) => tool.id),
  };
  const shapeIds = new Set(shapeStack.toolIds);
  const toolLayout: ToolLayoutItem[] = [];
  let insertedShapeStack = false;
  for (const tool of tools) {
    if (shapeIds.has(tool.id)) {
      if (!insertedShapeStack) {
        toolLayout.push({ type: 'stack', stackId: shapeStack.id });
        insertedShapeStack = true;
      }
    } else {
      toolLayout.push({ type: 'tool', toolId: tool.id });
    }
  }
  return { tools, toolLayout, toolStacks: [shapeStack] };
}
