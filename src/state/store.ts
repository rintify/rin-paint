import { create } from 'zustand';
import {
  DEFAULT_PEN_DETAIL_SETTINGS,
  DEFAULT_TEXT_TOOL_SETTINGS,
  DEFAULT_CANVAS,
  newToolInstanceId,
  newToolStackId,
  TOOL_KIND_LABELS,
  type LayerMeta,
  type PenDetailSettings,
  type ToolInstance,
  type ToolKind,
  type ToolLayoutItem,
  type ToolStack,
  type CanvasSpec,
  type ProjectFont,
  type TextToolSettings,
} from '../types';

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

export function defaultTools(): ToolInstance[] {
  return [
    {
      id: newToolInstanceId(),
      kind: 'pen',
      name: 'ペン',
      size: 14,
      color: '#222222',
      penSettings: { ...DEFAULT_PEN_DETAIL_SETTINGS },
    },
    { id: newToolInstanceId(), kind: 'lasso', name: '選択', size: 14, color: '#222222' },
  ];
}

export interface PaintState {
  /** ツールエリアに並ぶツールインスタンス */
  tools: ToolInstance[];
  toolLayout: ToolLayoutItem[];
  toolStacks: ToolStack[];
  activeToolId: string | null;
  /** アクティブインスタンスの形 (エンジンが参照する) */
  tool: ToolKind | null;
  /** アクティブインスタンスの太さ・色のミラー */
  penSize: number;
  penColor: string;
  colorHistory: string[];

  layers: LayerMeta[];
  activeLayerId: string;
  selectedLayerIds: string[];
  multiSelectMode: boolean;
  clipboardAvailable: boolean;

  pages: { id: string; thumbnailVersion: number }[];
  activePageId: string;
  pageBusy: boolean;

  /** アートボードのピクセルサイズ (エンジンと同期) */
  canvasW: number;
  canvasH: number;
  canvasSpec: CanvasSpec;
  fonts: ProjectFont[];
  textEditingId: string | null;
  projectGeneration: number;

  canUndo: boolean;
  canRedo: boolean;
  /** 現在の履歴ノードの子 (2つ以上あるとき進む時に分岐選択UIを出す) */
  redoBranches: RedoBranch[];
  historyCount: number;
  historyPrunableCount: number;

  timelapseEnabled: boolean;
  storageUsage: StorageUsage;

  selectionActive: boolean;
  /** 浮動選択の自由変形モード */
  freeTransform: boolean;
  /** 0..1 で進捗、null なら書き出し中でない */
  exportProgress: number | null;

  /** 表示倍率 (1 = フィット) と表示回転 (ラジアン) */
  viewScale: number;
  viewRot: number;

  set: (p: Partial<PaintState>) => void;
  pushColor: (c: string) => void;
  /** アクティブインスタンスの太さを変更 (インスタンスにも保存) */
  setPenSize: (n: number) => void;
  /** アクティブインスタンスの色を変更 (インスタンスにも保存) */
  setPenColor: (c: string) => void;
  /** アクティブなペンインスタンスの詳細設定を変更 */
  setPenDetail: (key: keyof PenDetailSettings, value: number) => void;
  /** 文字ツールで新しく作る文字の初期書式を変更 */
  setTextToolSettings: (patch: Partial<TextToolSettings>) => void;
  /** インスタンスを切り替え、記憶された色・太さを反映する */
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
}

const initialTools = defaultTools();
const initialLayout: ToolLayoutItem[] = initialTools.map((tool) => ({ type: 'tool', toolId: tool.id }));

function normalizeToolLayout(tools: ToolInstance[], layout: ToolLayoutItem[], stacks: ToolStack[]) {
  const validTools = new Set(tools.map((tool) => tool.id));
  const cleanedStacks = stacks.map((stack) => ({ ...stack, toolIds: stack.toolIds.filter((id) => validTools.has(id)) }));
  const singleton = new Map(cleanedStacks.filter(stack => stack.toolIds.length === 1).map(stack => [stack.id, stack.toolIds[0]]));
  layout = layout.flatMap(item => item.type === 'stack' && singleton.has(item.stackId) ? [{ type: 'tool' as const, toolId: singleton.get(item.stackId)! }] : [item]);
  const nextStacks = cleanedStacks.filter((stack) => stack.toolIds.length >= 2);
  const stacked = new Set(nextStacks.flatMap((stack) => stack.toolIds));
  const validStacks = new Set(nextStacks.map((stack) => stack.id));
  const seenTools = new Set<string>();
  const seenStacks = new Set<string>();
  const nextLayout: ToolLayoutItem[] = [];
  for (const item of layout) {
    if (item.type === 'tool') {
      if (validTools.has(item.toolId) && !stacked.has(item.toolId) && !seenTools.has(item.toolId)) {
        seenTools.add(item.toolId); nextLayout.push(item);
      }
    } else if (validStacks.has(item.stackId) && !seenStacks.has(item.stackId)) {
      seenStacks.add(item.stackId); nextLayout.push(item);
    }
  }
  for (const stack of nextStacks) if (!seenStacks.has(stack.id)) nextLayout.push({ type: 'stack', stackId: stack.id });
  for (const tool of tools) if (!stacked.has(tool.id) && !seenTools.has(tool.id)) nextLayout.push({ type: 'tool', toolId: tool.id });
  return { toolLayout: nextLayout, toolStacks: nextStacks };
}

export const useStore = create<PaintState>((set) => ({
  tools: initialTools,
  toolLayout: initialLayout,
  toolStacks: [],
  activeToolId: initialTools[0].id,
  tool: initialTools[0].kind,
  penSize: initialTools[0].size,
  penColor: initialTools[0].color,
  colorHistory: ['#222222', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#ffffff'],

  layers: [],
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
  exportProgress: null,

  viewScale: 1,
  viewRot: 0,

  set: (p) => set(p),
  pushColor: (c) =>
    set((s) =>
      // 透明は専用ボタンがあるので履歴パレットには積まない
      c === 'transparent'
        ? s
        : { colorHistory: [c, ...s.colorHistory.filter((x) => x !== c)].slice(0, 24) },
    ),

  setPenSize: (n) =>
    set((s) => ({
      penSize: n,
      tools: s.tools.map((t) => (t.id === s.activeToolId ? { ...t, size: n } : t)),
    })),

  setPenColor: (c) =>
    set((s) => ({
      penColor: c,
      tools: s.tools.map((t) => (t.id === s.activeToolId ? { ...t, color: c } : t)),
    })),

  setPenDetail: (key, value) =>
    set((s) => ({
      tools: s.tools.map((t) =>
        t.id === s.activeToolId && t.kind === 'pen'
          ? {
              ...t,
              penSettings: {
                ...DEFAULT_PEN_DETAIL_SETTINGS,
                ...t.penSettings,
                [key]: Math.max(0, Math.min(100, Math.round(value))),
              },
            }
          : t,
      ),
    })),

  setTextToolSettings: (patch) =>
    set((s) => ({
      tools: s.tools.map((tool) =>
        tool.id === s.activeToolId && tool.kind === 'text'
          ? { ...tool, textSettings: { ...DEFAULT_TEXT_TOOL_SETTINGS, ...tool.textSettings, ...patch } }
          : tool,
      ),
    })),

  activateTool: (id) =>
    set((s) => {
      const inst = s.tools.find((t) => t.id === id);
      if (!inst) return s;
      return {
        activeToolId: inst.id,
        tool: inst.kind,
        penSize: inst.size,
        penColor: inst.color,
      };
    }),

  deactivateTool: () => set({ activeToolId: null, tool: null }),

  addTool: (kind) =>
    set((s) => {
      const count = s.tools.filter((t) => t.kind === kind).length;
      const base = TOOL_KIND_LABELS[kind];
      const inst: ToolInstance = {
        id: newToolInstanceId(),
        kind,
        name: count === 0 ? base : `${base} ${count + 1}`,
        size: s.penSize,
        color: s.penColor,
        ...(kind === 'pen'
          ? { penSettings: { ...DEFAULT_PEN_DETAIL_SETTINGS } }
          : kind === 'text'
            ? { textSettings: { ...DEFAULT_TEXT_TOOL_SETTINGS } }
            : {}),
      };
      return {
        tools: [...s.tools, inst],
        toolLayout: [...s.toolLayout, { type: 'tool', toolId: inst.id }],
        activeToolId: inst.id,
        tool: inst.kind,
        penSize: inst.size,
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
}));
