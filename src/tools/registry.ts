import type { PaintEngine } from '../engine/PaintEngine';
import type { ToolInstance } from '../model/tool';
import { clampSizeMm, roundMm } from '../engine/units';
import { blurTool } from './blur';
import { cursorTool } from './cursor';
import { fillTool } from './fill';
import { lassoTool } from './lasso';
import { moveTool } from './move';
import { lineTool } from './line';
import { penTool } from './pen';
import { rectTool } from './rect';
import { ellipseTool } from './ellipse';
import { polygonTool } from './polygon';
import { polygonSplitTool } from './polygonSplit';
import { textTool } from './text';
import { imageTool } from './image';
import { eyedropperTool } from './eyedropper';
import { panelFrameTool } from './panelFrame';
import { speechBubbleTool } from './speechBubble';
import type { Tool, ToolDescriptor } from './types';

export const TOOL_REGISTRY = {
  cursor: cursorTool,
  pen: penTool,
  line: lineTool,
  rect: rectTool,
  ellipse: ellipseTool,
  polygon: polygonTool,
  panelFrame: panelFrameTool,
  speechBubble: speechBubbleTool,
  fill: fillTool,
  eyedropper: eyedropperTool,
  polygonSplit: polygonSplitTool,
  lasso: lassoTool,
  move: moveTool,
  blur: blurTool,
  text: textTool,
  image: imageTool,
} as const;

export type ToolKind = keyof typeof TOOL_REGISTRY;

export const TOOL_KINDS = Object.keys(TOOL_REGISTRY) as ToolKind[];

export function getToolDescriptor(kind: string): ToolDescriptor | undefined {
  if (!isToolKind(kind)) return undefined;
  return TOOL_REGISTRY[kind];
}

export function isToolKind(k: string): k is ToolKind {
  return k in TOOL_REGISTRY;
}

function legacySettings(kind: ToolKind, raw: Record<string, unknown>): unknown {
  if (raw.settings !== undefined) return raw.settings;
  switch (kind) {
    case 'pen':
      return raw.penSettings;
    case 'text':
      return raw.textSettings;
    case 'image':
      return raw.imageSettings;
    case 'fill':
      return raw.fillSettings;
    case 'eyedropper':
      return raw.eyedropperSettings;
    case 'rect':
    case 'ellipse':
    case 'polygon':
      return raw.shapeSettings;
    case 'polygonSplit':
      return raw.polygonSplitSettings;
    default:
      return undefined;
  }
}

export function normalizeToolInstance(raw: unknown): ToolInstance | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  if (typeof o.kind !== 'string' || !isToolKind(o.kind)) return null;
  if (typeof o.name !== 'string') return null;
  if (typeof o.sizeMm !== 'number' || !Number.isFinite(o.sizeMm)) return null;
  if (typeof o.color !== 'string') return null;

  const descriptor = TOOL_REGISTRY[o.kind];
  const base: ToolInstance = {
    id: o.id,
    kind: o.kind,
    name: o.name,
    sizeMm: roundMm(clampSizeMm(o.sizeMm)),
    color: o.color,
  };

  if (descriptor.settings) {
    return {
      ...base,
      settings: descriptor.settings.normalize(legacySettings(o.kind, o)),
    };
  }
  return base;
}

export function createTool(kind: ToolKind, engine: PaintEngine): Tool {
  return TOOL_REGISTRY[kind].create(engine);
}

export const TOOL_KIND_LABELS = Object.fromEntries(
  TOOL_KINDS.map((kind) => [kind, TOOL_REGISTRY[kind].label]),
) as Record<ToolKind, string>;

export {
  DEFAULT_CURSOR_TOOL_SETTINGS,
  normalizeCursorToolSettings,
  resolveCursorToolSettings,
  type CursorToolSettings,
} from './cursor/settings';
export {
  DEFAULT_EYEDROPPER_TOOL_SETTINGS,
  normalizeEyedropperToolSettings,
  type EyedropperSource,
  type EyedropperToolSettings,
} from './eyedropper/settings';
export {
  DEFAULT_PEN_DETAIL_SETTINGS,
  normalizePenDetailSettings,
  type PenDetailSettings,
} from './pen/settings';
export {
  DEFAULT_FILL_TOOL_SETTINGS,
  normalizeFillToolSettings,
  type FillToolSettings,
} from './fill/settings';
export {
  DEFAULT_TEXT_TOOL_SETTINGS,
  normalizeTextToolSettings,
  type TextToolSettings,
} from './text/settings';
export {
  DEFAULT_SHAPE_TOOL_SETTINGS,
  normalizeShapeToolSettings,
  type ShapeToolSettings,
} from './shape/settings';
export {
  DEFAULT_POLYGON_SPLIT_TOOL_SETTINGS,
  normalizePolygonSplitToolSettings,
  type PolygonSplitToolSettings,
} from './polygonSplit/settings';
export {
  DEFAULT_IMAGE_TOOL_SETTINGS,
  normalizeImageToolSettings,
  type ImageToolSettings,
} from './image/settings';
export {
  DEFAULT_PANEL_FRAME_TOOL_SETTINGS,
  normalizePanelFrameToolSettings,
  type PanelFrameToolSettings,
} from './panelFrame/settings';
export {
  DEFAULT_SPEECH_BUBBLE_TOOL_SETTINGS,
  normalizeSpeechBubbleToolSettings,
  type SpeechBubbleToolSettings,
} from './speechBubble/settings';
