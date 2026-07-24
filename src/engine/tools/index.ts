import { brushTool, eraserTool } from './brush'
import { lassoTool } from './lasso'
import { ellipseTool, lineTool, rectTool } from './shape'
import type { Tool } from './types'
import type { ToolId } from '../types'

export const tools: Record<ToolId, Tool> = {
  brush: brushTool,
  eraser: eraserTool,
  line: lineTool,
  rect: rectTool,
  ellipse: ellipseTool,
  lasso: lassoTool,
}

export { lassoTool }
export type { Tool, ToolHost, ToolPointerEvent, SelectionState } from './types'
