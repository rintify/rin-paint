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

  /** ルートを除く、現在保持している操作ノード数 */
  nodeCount(): number {
    let count = 0;
    const visit = (node: HistoryNode) => {
      for (const child of node.children) {
        count++;
        visit(child);
      }
    };
    visit(this.root);
    return count;
  }

  /** 履歴が保持している画像ペイロードの概算バイト数 */
  retainedBytes(): number {
    const snapshotBytes = (snapshot: LayerSnapshot): number =>
      snapshot.blob?.size ??
      (snapshot.canvas ? snapshot.canvas.width * snapshot.canvas.height * 4 : 0);
    const opBytes = (op: Op | null): number => {
      if (!op) return 0;
      if (op.kind === 'raster') {
        return op.tiles.reduce(
          (sum, tile) =>
            sum +
            (tile.before?.size ?? tile.w * tile.h * 4) +
            (tile.after?.size ?? tile.w * tile.h * 4),
          0,
        );
      }
      if (op.kind === 'layerAdd' || op.kind === 'layerRemove') {
        return snapshotBytes(op.snapshot);
      }
      if (op.kind === 'layerMerge') {
        return [...op.before, ...op.after].reduce(
          (sum, entry) => sum + snapshotBytes(entry.snapshot),
          0,
        );
      }
      return 0;
    };

    let bytes = 0;
    const visit = (node: HistoryNode) => {
      bytes += opBytes(node.op);
      for (const child of node.children) visit(child);
    };
    visit(this.root);
    return bytes;
  }

  prunableCount(limit: number): number {
    let depth = 0;
    for (let node = this.current; node !== this.root; node = node.parent!) depth++;
    return Math.max(0, this.nodeCount() - Math.min(depth, Math.max(0, Math.floor(limit))));
  }

  /**
   * 現在位置から過去へ limit 操作だけを残す。
   * 現在位置より先の redo と、現在の経路に含まれない分岐も破棄する。
   */
  pruneToRecent(limit: number): number {
    const before = this.nodeCount();
    const keep = Math.max(0, Math.floor(limit));
    const path: HistoryNode[] = [];
    for (let node: HistoryNode | null = this.current; node; node = node.parent) {
      path.push(node);
    }
    path.reverse();

    // 残す操作の直前の状態を、新しい番兵ルートとして利用する。
    const baseIndex = Math.max(0, path.length - keep - 1);
    const retained = path.slice(baseIndex);
    const base = retained[0];
    base.parent = null;
    base.op = null;
    base.ready = undefined;
    base.label = '開始';
    this.root = base;

    for (let i = 0; i < retained.length; i++) {
      const node = retained[i];
      const next = retained[i + 1];
      node.children = next ? [next] : [];
      node.lastChild = 0;
      if (next) next.parent = node;
    }

    return before - this.nodeCount();
  }
}
