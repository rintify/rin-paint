import { create } from 'zustand';
import { DEFAULT_CANVAS, type CanvasSpec } from '../model/canvas';
import { type LayerMeta } from '../model/layer';
import { type ProjectFont } from '../model/text';
import {
  newToolInstanceId,
  newToolStackId,
  type ToolInstance,
  type ToolLayoutItem,
  type ToolStack,
} from '../model/tool';
import { DEFAULT_SIZE_MM, clampSizeMm, roundMm } from '../engine/units';
import { DEFAULT_PEN_DETAIL_SETTINGS } from '../tools/pen/settings';
import { DEFAULT_FILL_TOOL_SETTINGS } from '../tools/fill/settings';
import { DEFAULT_SHAPE_TOOL_SETTINGS } from '../tools/shape/settings';
import { DEFAULT_POLYGON_SPLIT_TOOL_SETTINGS } from '../tools/polygonSplit/settings';
import { DEFAULT_TEXT_TOOL_SETTINGS } from '../tools/text/settings';
import { DEFAULT_EYEDROPPER_TOOL_SETTINGS } from '../tools/eyedropper/settings';
import { getToolDescriptor, isToolKind, type ToolKind } from '../tools/registry';
import { normalizeToolLayout } from './toolLayout';
import { defaultShortcutBindings, type ShortcutBindings, type ShortcutId } from '../shortcuts';

export interface RedoBranch {
  index: number;
  label: string;
}

export interface StorageUsage {
  history: number;
  project: number;
  timelapse: number;
  other: number;
  total: number;
}

export interface DefaultToolSetup {
  tools: ToolInstance[];
  toolLayout: ToolLayoutItem[];
  toolStacks: ToolStack[];
}

/** 初回起動用。全種類を1つずつ作り、図形系だけを1つのスタックへまとめる。 */
export function defaultToolSetup(): DefaultToolSetup {
  // registry -> PaintEngine -> store の循環初期化を避けるため、初期値はデータだけで定義する。
  const definitions: { kind: ToolKind; name: string; shape?: boolean; settings?: unknown }[] = [
    { kind: 'pen', name: 'ペン', settings: { ...DEFAULT_PEN_DETAIL_SETTINGS } },
    { kind: 'line', name: '直線', shape: true },
    { kind: 'rect', name: '四角', shape: true, settings: { ...DEFAULT_SHAPE_TOOL_SETTINGS } },
    { kind: 'ellipse', name: '楕円', shape: true, settings: { ...DEFAULT_SHAPE_TOOL_SETTINGS } },
    { kind: 'polygon', name: '多角形', shape: true, settings: { ...DEFAULT_SHAPE_TOOL_SETTINGS } },
    { kind: 'fill', name: '塗りつぶし', settings: { ...DEFAULT_FILL_TOOL_SETTINGS } },
    { kind: 'eyedropper', name: 'スポイト', settings: { ...DEFAULT_EYEDROPPER_TOOL_SETTINGS } },
    { kind: 'polygonSplit', name: '多角形分断', settings: { ...DEFAULT_POLYGON_SPLIT_TOOL_SETTINGS } },
    { kind: 'lasso', name: '選択' },
    { kind: 'blur', name: 'ぼかし' },
    { kind: 'text', name: '文字', settings: { ...DEFAULT_TEXT_TOOL_SETTINGS } },
  ];
  const tools = definitions.map(({ kind, name, settings }) => {
    return {
      id: newToolInstanceId(),
      kind,
      name,
      sizeMm: DEFAULT_SIZE_MM,
      color: '#222222',
      ...(settings !== undefined ? { settings } : {}),
    } satisfies ToolInstance;
  });
  const shapeKinds = new Set(definitions.filter(item => item.shape).map(item => item.kind));
  const shapeTools = tools.filter(tool => shapeKinds.has(tool.kind as ToolKind));
  const shapeStack: ToolStack = {
    id: newToolStackId(),
    name: '図形',
    toolIds: shapeTools.map(tool => tool.id),
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

export function defaultTools(): ToolInstance[] { return defaultToolSetup().tools; }

export interface PaintState {
  tools: ToolInstance[];
  toolLayout: ToolLayoutItem[];
  toolStacks: ToolStack[];
  activeToolId: string | null;
  tool: ToolKind | null;
  penSizeMm: number;
  penColor: string;
  colorHistory: string[];
  shortcuts: ShortcutBindings;
  shortcutTarget: { type: 'layer' | 'tool' | 'stack'; id: string } | null;

  layers: LayerMeta[];
  rootLayerIds: string[];
  activeLayerId: string;
  selectedLayerIds: string[];
  multiSelectMode: boolean;
  clipboardAvailable: boolean;

  pages: { id: string; thumbnailVersion: number }[];
  activePageId: string;
  pageBusy: boolean;

  canvasW: number;
  canvasH: number;
  canvasSpec: CanvasSpec;
  fonts: ProjectFont[];
  textEditingId: string | null;
  projectGeneration: number;

  canUndo: boolean;
  canRedo: boolean;
  redoBranches: RedoBranch[];
  historyCount: number;
  historyPrunableCount: number;

  timelapseEnabled: boolean;
  storageUsage: StorageUsage;

  selectionActive: boolean;
  freeTransform: boolean;
  polygonDraftActive: boolean;
  polygonDraftPointCount: number;
  shapeHandleSelected: boolean;
  shapeHandleCanDelete: boolean;
  shapeHandleIsVertex: boolean;
  shapeHandleEdgeConstrained: boolean;
  fillProgress: number | null;
  toolNotice: string | null;
  exportProgress: number | null;

  viewScale: number;
  viewRot: number;

  set: (p: Partial<PaintState>) => void;
  pushColor: (c: string) => void;
  setPenSizeMm: (n: number) => void;
  setPenColor: (c: string) => void;
  /** アクティブツールの settings を部分更新 (descriptor.normalize でクランプ) */
  updateActiveToolSettings: (patch: Record<string, unknown>) => void;
  activateTool: (id: string) => void;
  deactivateTool: () => void;
  addTool: (kind: ToolKind) => void;
  removeTool: (id: string) => void;
  reorderTools: (from: number, to: number) => void;
  reorderToolLayout: (from: number, to: number) => void;
  reorderStackTools: (stackId: string, from: number, to: number) => void;
  renameTool: (id: string, name: string) => void;
  renameToolStack: (id: string, name: string) => void;
  createToolStack: (sourceToolId: string, targetToolId: string) => void;
  moveToolToStack: (toolId: string, stackId: string, targetIndex?: number) => void;
  unstackTool: (toolId: string, targetIndex?: number) => void;
  dissolveToolStack: (stackId: string) => void;
  setShortcut: (id: ShortcutId, binding: string) => void;
  resetShortcuts: () => void;
}

const initialToolSetup = defaultToolSetup();
const initialTools = initialToolSetup.tools;

export const useStore = create<PaintState>((set) => ({
  tools: initialTools,
  toolLayout: initialToolSetup.toolLayout,
  toolStacks: initialToolSetup.toolStacks,
  activeToolId: initialTools[0].id,
  tool: initialTools[0].kind as ToolKind,
  penSizeMm: initialTools[0].sizeMm,
  penColor: initialTools[0].color,
  colorHistory: ['#222222', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#ffffff'],
  shortcuts: defaultShortcutBindings(),
  shortcutTarget: null,

  layers: [],
  rootLayerIds: [],
  activeLayerId: '',
  selectedLayerIds: [],
  multiSelectMode: false,
  clipboardAvailable: false,

  pages: [],
  activePageId: '',
  pageBusy: false,

  canvasW: 1600,
  canvasH: 1200,
  canvasSpec: { ...DEFAULT_CANVAS },
  fonts: [],
  textEditingId: null,
  projectGeneration: 0,

  canUndo: false,
  canRedo: false,
  redoBranches: [],
  historyCount: 0,
  historyPrunableCount: 0,

  timelapseEnabled: true,
  storageUsage: { history: 0, project: 0, timelapse: 0, other: 0, total: 0 },

  selectionActive: false,
  freeTransform: false,
  polygonDraftActive: false,
  polygonDraftPointCount: 0,
  shapeHandleSelected: false,
  shapeHandleCanDelete: false,
  shapeHandleIsVertex: false,
  shapeHandleEdgeConstrained: false,
  fillProgress: null,
  toolNotice: null,
  exportProgress: null,

  viewScale: 1,
  viewRot: 0,

  set: (p) => set(p),
  pushColor: (c) =>
    set((s) =>
      c === 'transparent'
        ? s
        : { colorHistory: [c, ...s.colorHistory.filter((x) => x !== c)].slice(0, 24) },
    ),

  setPenSizeMm: (n) =>
    set((s) => {
      const sizeMm = roundMm(clampSizeMm(n));
      return {
        penSizeMm: sizeMm,
        tools: s.tools.map((t) => (t.id === s.activeToolId ? { ...t, sizeMm } : t)),
      };
    }),

  setPenColor: (c) =>
    set((s) => ({
      penColor: c,
      tools: s.tools.map((t) => (t.id === s.activeToolId ? { ...t, color: c } : t)),
    })),

  updateActiveToolSettings: (patch) =>
    set((s) => {
      if (!s.activeToolId || !s.tool) return s;
      const descriptor = getToolDescriptor(s.tool);
      if (!descriptor?.settings) return s;
      const inst = s.tools.find((t) => t.id === s.activeToolId);
      const current = descriptor.settings.normalize(inst?.settings) as Record<string, unknown>;
      const next = descriptor.settings.normalize({ ...current, ...patch });
      return {
        tools: s.tools.map((t) => (t.id === s.activeToolId ? { ...t, settings: next } : t)),
      };
    }),

  activateTool: (id) =>
    set((s) => {
      const inst = s.tools.find((t) => t.id === id);
      if (!inst || !isToolKind(inst.kind)) return s;
      return {
        activeToolId: inst.id,
        tool: inst.kind,
        penSizeMm: inst.sizeMm,
        penColor: inst.color,
      };
    }),

  deactivateTool: () => set({ activeToolId: null, tool: null }),

  addTool: (kind) =>
    set((s) => {
      const descriptor = getToolDescriptor(kind);
      if (!descriptor) return s;
      const count = s.tools.filter((t) => t.kind === kind).length;
      const base = descriptor.label;
      const inst: ToolInstance = {
        id: newToolInstanceId(),
        kind,
        name: count === 0 ? base : `${base} ${count + 1}`,
        sizeMm: s.penSizeMm,
        color: s.penColor,
        ...(descriptor.settings ? { settings: descriptor.settings.default() } : {}),
      };
      return {
        tools: [...s.tools, inst],
        toolLayout: [...s.toolLayout, { type: 'tool', toolId: inst.id }],
        activeToolId: inst.id,
        tool: kind,
        penSizeMm: inst.sizeMm,
        penColor: inst.color,
      };
    }),

  removeTool: (id) =>
    set((s) => {
      const idx = s.tools.findIndex((t) => t.id === id);
      if (idx < 0) return s;
      const tools = s.tools.filter((t) => t.id !== id);
      const layout = s.toolLayout.filter((item) => item.type !== 'tool' || item.toolId !== id);
      const stacks = s.toolStacks.map((stack) => ({ ...stack, toolIds: stack.toolIds.filter((toolId) => toolId !== id) }));
      const normalized = normalizeToolLayout(tools, layout, stacks);
      if (id !== s.activeToolId) return { tools, ...normalized };
      return {
        tools,
        ...normalized,
        activeToolId: null,
        tool: null,
      };
    }),

  reorderTools: (from, to) =>
    set((s) => {
      if (from < 0 || to < 0 || from >= s.tools.length || to >= s.tools.length || from === to) return s;
      const tools = [...s.tools];
      const [tool] = tools.splice(from, 1);
      tools.splice(to, 0, tool);
      const layout = [...s.toolLayout];
      const sourceIndex = layout.findIndex(item => item.type === 'tool' && item.toolId === tool.id);
      if (sourceIndex >= 0) {
        const [item] = layout.splice(sourceIndex, 1);
        const targetId = tools[to === tools.length - 1 ? to - 1 : to + 1]?.id;
        const targetStack = s.toolStacks.find(stack => targetId && stack.toolIds.includes(targetId));
        let targetIndex = targetId ? layout.findIndex(entry => entry.type === 'tool' ? entry.toolId === targetId : entry.stackId === targetStack?.id) : layout.length;
        if (targetIndex < 0) targetIndex = layout.length;
        layout.splice(from < to ? targetIndex + 1 : targetIndex, 0, item);
      }
      return { tools, toolLayout: layout };
    }),

  reorderToolLayout: (from, to) => set((s) => {
    if (from < 0 || from >= s.toolLayout.length) return s;
    const layout = [...s.toolLayout];
    const [item] = layout.splice(from, 1);
    const target = Math.max(0, Math.min(to, layout.length));
    layout.splice(target, 0, item);
    return { toolLayout: layout };
  }),
  reorderStackTools: (stackId, from, to) => set((s) => ({
    toolStacks: s.toolStacks.map(stack => {
      if (stack.id !== stackId || from < 0 || from >= stack.toolIds.length) return stack;
      const toolIds = [...stack.toolIds];
      const [id] = toolIds.splice(from, 1);
      toolIds.splice(Math.max(0, Math.min(to, toolIds.length)), 0, id);
      return { ...stack, toolIds };
    }),
  })),

  renameTool: (id, name) => set((s) => ({ tools: s.tools.map((tool) => tool.id === id ? { ...tool, name } : tool) })),
  renameToolStack: (id, name) => set((s) => ({ toolStacks: s.toolStacks.map((stack) => stack.id === id ? { ...stack, name } : stack) })),
  createToolStack: (sourceToolId, targetToolId) => set((s) => {
    if (sourceToolId === targetToolId) return s;
    const source = s.tools.find((tool) => tool.id === sourceToolId);
    const target = s.tools.find((tool) => tool.id === targetToolId);
    if (!source || !target || s.toolStacks.some((stack) => stack.toolIds.includes(sourceToolId) || stack.toolIds.includes(targetToolId))) return s;
    const sourceIndex = s.toolLayout.findIndex((item) => item.type === 'tool' && item.toolId === sourceToolId);
    const targetIndex = s.toolLayout.findIndex((item) => item.type === 'tool' && item.toolId === targetToolId);
    if (sourceIndex < 0 || targetIndex < 0) return s;
    const stack: ToolStack = { id: newToolStackId(), name: 'グループ', toolIds: [targetToolId, sourceToolId] };
    const toolLayout = s.toolLayout.filter((item) => item.type !== 'tool' || (item.toolId !== sourceToolId && item.toolId !== targetToolId));
    toolLayout.splice(Math.min(sourceIndex, targetIndex), 0, { type: 'stack', stackId: stack.id });
    return { toolLayout, toolStacks: [...s.toolStacks, stack] };
  }),
  moveToolToStack: (toolId, stackId, targetIndex) => set((s) => {
    if (!s.tools.some((tool) => tool.id === toolId)) return s;
    const stacks = s.toolStacks.map((stack) => ({ ...stack, toolIds: stack.toolIds.filter((id) => id !== toolId) }));
    const target = stacks.find((stack) => stack.id === stackId);
    if (!target) return s;
    target.toolIds.splice(Math.max(0, Math.min(targetIndex ?? target.toolIds.length, target.toolIds.length)), 0, toolId);
    const layout = s.toolLayout.filter((item) => item.type !== 'tool' || item.toolId !== toolId);
    return normalizeToolLayout(s.tools, layout, stacks);
  }),
  unstackTool: (toolId, targetIndex) => set((s) => {
    const owner = s.toolStacks.find((stack) => stack.toolIds.includes(toolId));
    if (!owner) return s;
    const groupIndex = s.toolLayout.findIndex((item) => item.type === 'stack' && item.stackId === owner.id);
    const stacks = s.toolStacks.map((stack) => ({ ...stack, toolIds: stack.toolIds.filter((id) => id !== toolId) }));
    const layout = s.toolLayout.filter((item) => item.type !== 'tool' || item.toolId !== toolId);
    layout.splice(Math.max(0, Math.min(targetIndex ?? groupIndex + 1, layout.length)), 0, { type: 'tool', toolId });
    const remaining = stacks.find((stack) => stack.id === owner.id);
    if (remaining?.toolIds.length === 1) {
      const index = layout.findIndex((item) => item.type === 'stack' && item.stackId === owner.id);
      if (index >= 0) layout.splice(index, 1, { type: 'tool', toolId: remaining.toolIds[0] });
    }
    return normalizeToolLayout(s.tools, layout, stacks);
  }),
  dissolveToolStack: (stackId) => set((s) => {
    const stack = s.toolStacks.find((item) => item.id === stackId);
    if (!stack) return s;
    const index = s.toolLayout.findIndex((item) => item.type === 'stack' && item.stackId === stackId);
    const layout = s.toolLayout.filter((item) => item.type !== 'stack' || item.stackId !== stackId);
    layout.splice(Math.max(0, index), 0, ...stack.toolIds.map((toolId) => ({ type: 'tool' as const, toolId })));
    return normalizeToolLayout(s.tools, layout, s.toolStacks.filter((item) => item.id !== stackId));
  }),
  setShortcut: (id, binding) => set((s) => ({ shortcuts: { ...s.shortcuts, [id]: binding } })),
  resetShortcuts: () => set({ shortcuts: defaultShortcutBindings() }),
}));
