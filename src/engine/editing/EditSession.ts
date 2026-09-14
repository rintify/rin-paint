import { applyLayerProps, layerHandler } from '../layer-types/registry';
import type { Layer } from '../layers';
import type { LayerProps } from '../layer-types/definition';
import type { HistoryTree, AtomicOp } from '../history/historyTree';

export interface SessionLayer {
  id: string;
  start: LayerProps;
}

/**
 * プレビューは実行時レイヤーだけを動かし、確定まで履歴・ドキュメントへ書かない。
 */
export class EditSession {
  private layers = new Map<string, SessionLayer>();

  get active(): boolean {
    return this.layers.size > 0;
  }

  targetIds(): string[] {
    return [...this.layers.keys()];
  }

  begin(layers: Layer[]): void {
    this.layers.clear();
    for (const layer of layers) {
      this.layers.set(layer.id, {
        id: layer.id,
        start: {
          name: layer.name,
          opacity: layer.opacity,
          blend: layer.blend,
          visible: layer.visible,
          parameterLink: layer.parameterLink ? structuredClone(layer.parameterLink) : null,
          state: layerHandler(layer).state.clone(layer.state as never),
        },
      });
    }
  }

  startProps(layerId: string): LayerProps | undefined {
    return this.layers.get(layerId)?.start;
  }

  cancel(layers: Layer[]): void {
    for (const layer of layers) {
      const start = this.layers.get(layer.id)?.start;
      if (start) applyLayerProps(layer, structuredClone(start));
    }
    this.layers.clear();
  }

  commit(
    layers: Layer[],
    history: HistoryTree,
    label: string,
  ): boolean {
    const ops: AtomicOp[] = [];
    for (const layer of layers) {
      const start = this.layers.get(layer.id)?.start;
      if (!start) continue;
      const after: LayerProps = {
        name: layer.name,
        opacity: layer.opacity,
        blend: layer.blend,
        visible: layer.visible,
        parameterLink: layer.parameterLink ? structuredClone(layer.parameterLink) : null,
        state: layerHandler(layer).state.clone(layer.state as never),
      };
      ops.push({
        kind: 'layerProps',
        layerId: layer.id,
        before: structuredClone(start),
        after,
      });
    }
    this.layers.clear();
    if (!ops.length) return false;
    history.push(ops.length === 1 ? ops[0] : { kind: 'batch', ops }, label);
    return true;
  }

  discard(): void {
    this.layers.clear();
  }
}
