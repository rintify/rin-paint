import type { AdjustParams, BlendMode, LayerType } from '../../types';
import type { TilePatch } from './tilePatch';

/** レイヤー構造操作の undo/redo 用スナップショット */
export interface LayerSnapshot {
  id: string;
  type: LayerType;
  name: string;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  params?: AdjustParams;
  /** ラスター内容。作成直後は canvas、PNG エンコード完了後は blob に置き換わる */
  canvas?: HTMLCanvasElement;
  blob?: Blob;
}

export interface LayerProps {
  opacity?: number;
  blend?: BlendMode;
  visible?: boolean;
  params?: AdjustParams;
}

export interface IndexedLayerSnapshot {
  index: number;
  snapshot: LayerSnapshot;
}

export type Op =
  | { kind: 'raster'; layerId: string; tiles: TilePatch[] }
  | { kind: 'layerAdd'; index: number; snapshot: LayerSnapshot }
  | { kind: 'layerRemove'; index: number; snapshot: LayerSnapshot }
  | { kind: 'layerMove'; from: number; to: number }
  | { kind: 'layerProps'; layerId: string; before: LayerProps; after: LayerProps }
  | {
      kind: 'layerMerge';
      before: IndexedLayerSnapshot[];
      after: IndexedLayerSnapshot[];
      beforeActiveId: string;
      afterActiveId: string;
    };

export interface HistoryNode {
  id: number;
  label: string;
  op: Op | null;
  parent: HistoryNode | null;
  children: HistoryNode[];
  /** redo 時にたどる子のインデックス(最後に通った枝) */
  lastChild: number;
  /** タイルの Blob エンコード完了待ち */
  ready?: Promise<void>;
}

/**
 * 樹状履歴。undo で親へ戻り、戻った状態から新しい操作をすると
 * 新しい子ブランチが生えて古いブランチもそのまま残る。
 */
export class HistoryTree {
  root: HistoryNode;
  current: HistoryNode;
  private seq = 0;

  constructor() {
    this.root = {
      id: this.seq++,
      label: '開始',
      op: null,
      parent: null,
      children: [],
      lastChild: 0,
    };
    this.current = this.root;
  }

  push(op: Op, label: string): HistoryNode {
    const node: HistoryNode = {
      id: this.seq++,
      label,
      op,
      parent: this.current,
      children: [],
      lastChild: 0,
    };
    this.current.children.push(node);
    this.current.lastChild = this.current.children.length - 1;
    this.current = node;
    return node;
  }

  canUndo(): boolean {
    return this.current !== this.root;
  }

  canRedo(): boolean {
    return this.current.children.length > 0;
  }

  /** 戻る対象のノード(=現在ノード)を返し、ポインタを親へ移す */
  undo(): HistoryNode | null {
    if (!this.canUndo()) return null;
    const node = this.current;
    this.current = node.parent!;
    return node;
  }

  /** 指定した(または最後に通った)子へ進み、そのノードを返す */
  redo(childIndex?: number): HistoryNode | null {
    const parent = this.current;
    if (parent.children.length === 0) return null;
    const i = Math.min(
      childIndex ?? parent.lastChild,
      parent.children.length - 1,
    );
    parent.lastChild = i;
    this.current = parent.children[i];
    return this.current;
  }

  /** 現在ノードが葉であれば木から取り除く(タップ取り消し用) */
  removeCurrentLeaf(): HistoryNode | null {
    const node = this.current;
    if (node === this.root || node.children.length > 0) return null;
    const parent = node.parent!;
    const i = parent.children.indexOf(node);
    parent.children.splice(i, 1);
    parent.lastChild = Math.max(0, Math.min(parent.lastChild, parent.children.length - 1));
    this.current = parent;
    return node;
  }
}
