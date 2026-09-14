import type { LayerMeta } from '../../model';
import type { Layer } from '../layers';
import type { HistoryTree } from '../history/historyTree';

/** Keep unchanged UI records stable; pointer/selection updates must not rebuild every panel. */
export class StoreProjectionCache {
  private structure = '';
  private generation = 0;
  private layers = new WeakMap<
    Layer,
    { key: string; generation: number; meta: LayerMeta }
  >();
  private history?: {
    tree: HistoryTree;
    current: HistoryTree['current'];
    revision: number;
    count: number;
    prunable: number;
  };

  begin(layers: Layer[], roots: string[]): void {
    const structure = JSON.stringify([
      roots,
      layers.map((l) => [l.id, l.type, l.parentId, l.childIds]),
    ]);
    if (structure !== this.structure) {
      this.structure = structure;
      this.generation++;
    }
  }
  layer(layer: Layer, key: string, build: () => LayerMeta): LayerMeta {
    const previous = this.layers.get(layer);
    if (previous?.key === key && previous.generation === this.generation)
      return previous.meta;
    const meta = build();
    this.layers.set(layer, { key, generation: this.generation, meta });
    return meta;
  }
  historyCounts(tree: HistoryTree): { count: number; prunable: number } {
    if (
      this.history?.tree !== tree ||
      this.history.current !== tree.current ||
      this.history.revision !== tree.revision
    ) {
      this.history = {
        tree,
        current: tree.current,
        revision: tree.revision,
        count: tree.nodeCount(),
        prunable: tree.prunableCount(10),
      };
    }
    return this.history;
  }
}

export function reuseArray<T>(previous: T[], next: T[]): T[] {
  return previous.length === next.length &&
    previous.every((item, i) => item === next[i])
    ? previous
    : next;
}
