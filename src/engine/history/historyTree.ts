import type { LayerAddress, LayerParameterLink, PageSpec } from '../../model';
import type { LayerProps, LayerSnapshot } from '../layer-types/definition';
import { HISTORY_VERSION } from '../persistence/version';
import { opBytes } from './bytes';
import type { TilePatch } from './tilePatch';
import type { ParameterValue } from '../parameters/types';

export type { LayerProps, LayerSnapshot };

export interface LayerParameterOp {
  kind: 'layerParameter';
  layerId: string;
  parameterId: string;
  before: ParameterValue;
  after: ParameterValue;
}

export interface LayerLinkOp {
  kind: 'layerLink';
  target: LayerAddress;
  before: LayerParameterLink | null;
  after: LayerParameterLink | null;
}

export interface LayerLocation {
  parentId: string | null;
  index: number;
}

export interface LocatedLayerSnapshot {
  location: LayerLocation;
  snapshot: LayerSnapshot;
}

export interface LayerSelectionSnapshot {
  activeLayerId: string;
  selectedLayerIds: string[];
  multiSelectMode: boolean;
}

export interface LayerReplaceSide {
  rootIds: string[];
  entries: LocatedLayerSnapshot[];
  selection: LayerSelectionSnapshot;
}

export interface LayerReplaceOp {
  kind: 'layerReplace';
  before: LayerReplaceSide;
  after: LayerReplaceSide;
  maskChanges?: { layerId: string; before: string[]; after: string[] }[];
}

export interface TileLayerMergeOp {
  kind: 'layerMerge';
  format: 'tiles-v1';
  targetLayerId: string;
  removed: LocatedLayerSnapshot;
  tiles: TilePatch[];
  beforeActiveId: string;
  afterActiveId: string;
  /** Effect merges bake the target's rendered opacity/blend into its pixels. */
  targetProps?: { before: LayerProps; after: LayerProps };
  maskChanges?: { layerId: string; before: string[]; after: string[] }[];
}

export type LayerMergeOp = TileLayerMergeOp;

export interface LayerContentOp {
  kind: 'layerContent';
  layerId: string;
  before: LayerSnapshot;
  after: LayerSnapshot;
}

export type AtomicOp =
  | { kind: 'pageChange'; before: PageSnapshot; after: PageSnapshot }
  | { kind: 'raster'; layerId: string; tiles: TilePatch[] }
  | { kind: 'layerAdd'; location: LayerLocation; snapshot: LayerSnapshot }
  | { kind: 'layerRemove'; location: LayerLocation; snapshots: LayerSnapshot[] }
  | { kind: 'layerMove'; layerId: string; from: LayerLocation; to: LayerLocation }
  | { kind: 'layerProps'; layerId: string; before: LayerProps; after: LayerProps }
  | LayerParameterOp
  | LayerLinkOp
  | LayerReplaceOp
  | LayerMergeOp
  | LayerContentOp;

export type Op = AtomicOp | { kind: 'batch'; ops: AtomicOp[] };

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

export interface PersistedLayerSnapshot extends Omit<LayerSnapshot, 'canvas'> {
  content?: Blob;
}

export interface PageSnapshot {
  spec: PageSpec;
  layers: LayerSnapshot[];
  roots: string[];
  activeId: string;
}
export interface PersistedPageSnapshot extends Omit<PageSnapshot, 'layers'> {
  layers: PersistedLayerSnapshot[];
}

export interface PersistedTileLayerMergeOp {
  kind: 'layerMerge';
  format: 'tiles-v1';
  targetLayerId: string;
  removed: { location: LayerLocation; snapshot: PersistedLayerSnapshot };
  tiles: TilePatch[];
  beforeActiveId: string;
  afterActiveId: string;
  targetProps?: { before: LayerProps; after: LayerProps };
  maskChanges?: { layerId: string; before: string[]; after: string[] }[];
}

export interface PersistedLayerReplaceSide extends Omit<LayerReplaceSide, 'entries'> {
  entries: { location: LayerLocation; snapshot: PersistedLayerSnapshot }[];
}

export interface PersistedLayerReplaceOp extends Omit<LayerReplaceOp, 'before' | 'after'> {
  before: PersistedLayerReplaceSide;
  after: PersistedLayerReplaceSide;
}

export type PersistedAtomicOp =
  | { kind: 'pageChange'; before: PersistedPageSnapshot; after: PersistedPageSnapshot }
  | { kind: 'raster'; layerId: string; tiles: TilePatch[] }
  | { kind: 'layerAdd'; location: LayerLocation; snapshot: PersistedLayerSnapshot }
  | { kind: 'layerRemove'; location: LayerLocation; snapshots: PersistedLayerSnapshot[] }
  | { kind: 'layerMove'; layerId: string; from: LayerLocation; to: LayerLocation }
  | { kind: 'layerProps'; layerId: string; before: LayerProps; after: LayerProps }
  | LayerParameterOp
  | LayerLinkOp
  | PersistedLayerReplaceOp
  | PersistedTileLayerMergeOp
  | { kind: 'layerContent'; layerId: string; before: PersistedLayerSnapshot; after: PersistedLayerSnapshot };

export type PersistedOp = PersistedAtomicOp | { kind: 'batch'; ops: PersistedAtomicOp[] };

export interface PersistedHistory {
  version: typeof HISTORY_VERSION;
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
        content: value.content ?? (canvas ? await canvasToBlob(canvas) : undefined),
      };
    };
    const persistAtomic = async (op: AtomicOp): Promise<PersistedAtomicOp> => {
      switch (op.kind) {
        case 'pageChange':
          return {
            ...op,
            before: { ...op.before, layers: await Promise.all(op.before.layers.map(snapshot)) },
            after: { ...op.after, layers: await Promise.all(op.after.layers.map(snapshot)) },
          };
        case 'raster':
          return { ...op, tiles: op.tiles.map((tile) => ({ ...tile })) };
        case 'layerAdd':
          return { ...op, snapshot: await snapshot(op.snapshot) };
        case 'layerRemove':
          return { ...op, snapshots: await Promise.all(op.snapshots.map(snapshot)) };
        case 'layerMove':
          return { ...op };
        case 'layerProps':
          return { ...op, before: { ...op.before }, after: { ...op.after } };
        case 'layerParameter':
          return { ...op };
        case 'layerLink':
          return structuredClone(op);
        case 'layerReplace': {
          const side = async (value: LayerReplaceSide): Promise<PersistedLayerReplaceSide> => ({
            ...value,
            rootIds: [...value.rootIds],
            selection: { ...value.selection, selectedLayerIds: [...value.selection.selectedLayerIds] },
            entries: await Promise.all(value.entries.map(async entry => ({
              location: { ...entry.location },
              snapshot: await snapshot(entry.snapshot),
            }))),
          });
          return {
            ...op,
            before: await side(op.before),
            after: await side(op.after),
            maskChanges: op.maskChanges?.map(change => ({ ...change, before: [...change.before], after: [...change.after] })),
          };
        }
        case 'layerMerge':
          return {
            ...op,
            removed: {
              location: { ...op.removed.location },
              snapshot: await snapshot(op.removed.snapshot),
            },
            tiles: op.tiles.map((tile) => ({ ...tile })),
            targetProps: op.targetProps
              ? { before: { ...op.targetProps.before }, after: { ...op.targetProps.after } }
              : undefined,
            maskChanges: op.maskChanges?.map((change) => ({
              ...change,
              before: [...change.before],
              after: [...change.after],
            })),
          };
        case 'layerContent':
          return {
            ...op,
            before: await snapshot(op.before),
            after: await snapshot(op.after),
          };
      }
    };
    const persistOp = async (node: HistoryNode): Promise<PersistedOp | null> => {
      await node.ready;
      const op = node.op;
      if (!op) return null;
      return op.kind === 'batch'
        ? { kind: 'batch', ops: await Promise.all(op.ops.map(persistAtomic)) }
        : persistAtomic(op);
    };

    return {
      version: HISTORY_VERSION,
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
    // schema 検証は呼び出し側 (PaintEngine / schema.ts) でも行うが、ここでも version と木構造を見る。
    if (!value || typeof value !== 'object') return false;
    const saved = value as Partial<PersistedHistory>;
    if (saved.version !== HISTORY_VERSION || !Array.isArray(saved.nodes) || saved.nodes.length === 0) {
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

  undo(): HistoryNode | null {
    if (!this.canUndo()) return null;
    const node = this.current;
    this.current = node.parent!;
    return node;
  }

  redo(childIndex?: number): HistoryNode | null {
    const parent = this.current;
    if (parent.children.length === 0) return null;
    const i = Math.min(childIndex ?? parent.lastChild, parent.children.length - 1);
    parent.lastChild = i;
    this.current = parent.children[i];
    return this.current;
  }

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

  retainedBytes(): number {
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

  pruneToRecent(limit: number): number {
    const before = this.nodeCount();
    const keep = Math.max(0, Math.floor(limit));
    const path: HistoryNode[] = [];
    for (let node: HistoryNode | null = this.current; node; node = node.parent) {
      path.push(node);
    }
    path.reverse();

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
