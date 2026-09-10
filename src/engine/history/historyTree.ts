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

export interface PersistedLayerSnapshot
  extends Omit<LayerSnapshot, 'canvas'> {
  blob?: Blob;
}

export type PersistedOp =
  | { kind: 'raster'; layerId: string; tiles: TilePatch[] }
  | { kind: 'layerAdd'; index: number; snapshot: PersistedLayerSnapshot }
  | { kind: 'layerRemove'; index: number; snapshot: PersistedLayerSnapshot }
  | { kind: 'layerMove'; from: number; to: number }
  | { kind: 'layerProps'; layerId: string; before: LayerProps; after: LayerProps }
  | {
      kind: 'layerMerge';
      before: { index: number; snapshot: PersistedLayerSnapshot }[];
      after: { index: number; snapshot: PersistedLayerSnapshot }[];
      beforeActiveId: string;
      afterActiveId: string;
    };

export interface PersistedHistory {
  version: 1;
  rootId: number;
  currentId: number;
  nodes: {
    id: number;
    label: string;
    op: PersistedOp | null;
    parentId: number | null;
    childIds: number[];
    lastChild: number;
  }[];
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

  /** IndexedDB に保存できる循環参照なしの形式へ変換する。 */
  async serialize(
    canvasToBlob: (canvas: HTMLCanvasElement) => Promise<Blob>,
  ): Promise<PersistedHistory> {
    // 非同期変換中に新しい操作が追加されても、1つの時点の木構造を保存する。
    const currentId = this.current.id;
    const sourceNodes: HistoryNode[] = [];
    const visit = (node: HistoryNode) => {
      sourceNodes.push(node);
      for (const child of node.children) visit(child);
    };
    visit(this.root);
    const rootId = this.root.id;
    const structure = sourceNodes.map((node) => ({
      node,
      id: node.id,
      label: node.label,
      parentId: node.parent?.id ?? null,
      childIds: node.children.map((child) => child.id),
      lastChild: node.lastChild,
    }));

    const snapshot = async (value: LayerSnapshot): Promise<PersistedLayerSnapshot> => {
      const { canvas, ...rest } = value;
      return {
        ...rest,
        blob: value.blob ?? (canvas ? await canvasToBlob(canvas) : undefined),
      };
    };
    const indexed = async (entries: IndexedLayerSnapshot[]) =>
      Promise.all(
        entries.map(async (entry) => ({
          index: entry.index,
          snapshot: await snapshot(entry.snapshot),
        })),
      );
    const persistOp = async (node: HistoryNode): Promise<PersistedOp | null> => {
      await node.ready;
      const op = node.op;
      if (!op) return null;
      switch (op.kind) {
        case 'raster':
          return { ...op, tiles: op.tiles.map((tile) => ({ ...tile })) };
        case 'layerAdd':
        case 'layerRemove':
          return { ...op, snapshot: await snapshot(op.snapshot) };
        case 'layerMove':
          return { ...op };
        case 'layerProps':
          return {
            ...op,
            before: { ...op.before },
            after: { ...op.after },
          };
        case 'layerMerge':
          return {
            ...op,
            before: await indexed(op.before),
            after: await indexed(op.after),
          };
      }
    };

    return {
      version: 1,
      rootId,
      currentId,
      nodes: await Promise.all(
        structure.map(async (entry) => ({
          id: entry.id,
          label: entry.label,
          op: await persistOp(entry.node),
          parentId: entry.parentId,
          childIds: entry.childIds,
          lastChild: entry.lastChild,
        })),
      ),
    };
  }

  /** 保存済みの履歴を復元する。不正・旧形式なら false を返して空履歴を維持する。 */
  restore(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const saved = value as Partial<PersistedHistory>;
    if (saved.version !== 1 || !Array.isArray(saved.nodes) || saved.nodes.length === 0) {
      return false;
    }
    try {
      const nodes = new Map<number, HistoryNode>();
      for (const raw of saved.nodes) {
        if (
          !raw ||
          !Number.isInteger(raw.id) ||
          typeof raw.label !== 'string' ||
          !Array.isArray(raw.childIds)
        ) {
          return false;
        }
        if (nodes.has(raw.id)) return false;
        nodes.set(raw.id, {
          id: raw.id,
          label: raw.label,
          op: (raw.op ?? null) as Op | null,
          parent: null,
          children: [],
          lastChild: Number.isInteger(raw.lastChild) ? raw.lastChild : 0,
          ready: Promise.resolve(),
        });
      }
      for (const raw of saved.nodes) {
        const node = nodes.get(raw.id)!;
        if (raw.parentId !== null) {
          const parent = nodes.get(raw.parentId);
          if (!parent) return false;
          node.parent = parent;
        }
        node.children = raw.childIds.map((id) => {
          const child = nodes.get(id);
          if (!child) throw new Error('missing history child');
          return child;
        });
        node.lastChild = Math.max(
          0,
          Math.min(node.lastChild, Math.max(0, node.children.length - 1)),
        );
      }
      const root = nodes.get(saved.rootId!);
      const current = nodes.get(saved.currentId!);
      if (!root || !current || root.parent !== null) return false;
      const reachable = new Set<HistoryNode>();
      const verify = (node: HistoryNode) => {
        if (reachable.has(node)) throw new Error('cyclic history');
        reachable.add(node);
        for (const child of node.children) {
          if (child.parent !== node) throw new Error('invalid history parent');
          verify(child);
        }
      };
      verify(root);
      if (reachable.size !== nodes.size || !reachable.has(current)) return false;
      this.root = root;
      this.current = current;
      this.seq = Math.max(...nodes.keys()) + 1;
      return true;
    } catch {
      return false;
    }
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
