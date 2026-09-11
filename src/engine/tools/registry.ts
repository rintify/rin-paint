import type { ToolKind } from '../../model';
import { BlurTool } from './blur';
import { LassoTool } from './lasso';
import { PenTool } from './pen';
import { ShapeTool } from './shape';
import { TextTool } from './text';
import { FillTool } from './fill';
import { PolygonTool } from './polygon';
import { PolygonSplitTool } from './polygonSplit';
import type { Tool, ToolContext } from './types';

export const TOOL_KINDS: ToolKind[] = ['pen', 'line', 'rect', 'ellipse', 'polygon', 'fill', 'polygonSplit', 'lasso', 'blur', 'text'];

export const TOOL_FACTORIES: Record<ToolKind, (ctx: ToolContext) => Tool> = {
  pen: (c) => new PenTool(c),
  line: (c) => new ShapeTool(c, 'line'),
  rect: (c) => new ShapeTool(c, 'rect'),
  ellipse: (c) => new ShapeTool(c, 'ellipse'),
  polygon: (c) => new PolygonTool(c),
  fill: (c) => new FillTool(c),
  polygonSplit: (c) => new PolygonSplitTool(c),
  lasso: (c) => new LassoTool(c),
  blur: (c) => new BlurTool(c),
  text: (c) => new TextTool(c),
};

export function createTools(ctx: ToolContext): Record<ToolKind, Tool> {
  const tools = {} as Record<ToolKind, Tool>;
  for (const kind of TOOL_KINDS) tools[kind] = TOOL_FACTORIES[kind](ctx);
  return tools;
}
