import { create } from 'zustand';
import {
  DEFAULT_PEN_DETAIL_SETTINGS,
  newToolInstanceId,
  TOOL_KIND_LABELS,
  type LayerMeta,
  type PenDetailSettings,
  type ToolInstance,
  type ToolKind,
} from '../types';

export interface RedoBranch {
  index: number;
  label: string;
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
  activeToolId: string;
  /** アクティブインスタンスの形 (エンジンが参照する) */
  tool: ToolKind;
  /** アクティブインスタンスの太さ・色のミラー */
  penSize: number;
  penColor: string;
  colorHistory: string[];

  layers: LayerMeta[];
  activeLayerId: string;

  /** アートボードのピクセルサイズ (エンジンと同期) */
  canvasW: number;
  canvasH: number;

  canUndo: boolean;
  canRedo: boolean;
  /** 現在の履歴ノードの子 (2つ以上あるとき進む時に分岐選択UIを出す) */
  redoBranches: RedoBranch[];

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
  /** インスタンスを切り替え、記憶された色・太さを反映する */
  activateTool: (id: string) => void;
  addTool: (kind: ToolKind) => void;
  removeTool: (id: string) => void;
}

const initialTools = defaultTools();

export const useStore = create<PaintState>((set) => ({
  tools: initialTools,
  activeToolId: initialTools[0].id,
  tool: initialTools[0].kind,
  penSize: initialTools[0].size,
  penColor: initialTools[0].color,
  colorHistory: ['#222222', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#ffffff'],

  layers: [],
  activeLayerId: '',

  canvasW: 1600,
  canvasH: 1200,

  canUndo: false,
  canRedo: false,
  redoBranches: [],

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
          : {}),
      };
      return {
        tools: [...s.tools, inst],
        activeToolId: inst.id,
        tool: inst.kind,
        penSize: inst.size,
        penColor: inst.color,
      };
    }),

  removeTool: (id) =>
    set((s) => {
      if (s.tools.length <= 1) return s;
      const idx = s.tools.findIndex((t) => t.id === id);
      if (idx < 0) return s;
      const tools = s.tools.filter((t) => t.id !== id);
      if (id !== s.activeToolId) return { tools };
      const next = tools[Math.min(idx, tools.length - 1)];
      return {
        tools,
        activeToolId: next.id,
        tool: next.kind,
        penSize: next.size,
        penColor: next.color,
      };
    }),
}));
