import { useStore } from '../../state/store';
import type { Layer } from '../layers';
import { applyLayerProps, applyRecordProps, layerHandler, layerTypeProps } from '../layer-types/registry';
import type { LayerProps } from '../layer-types/definition';
import { editorAllowsNull, fromCanonical, toCanonical } from './codec';
import { parameterById, type ParameterHost } from './host';
import type { ParameterValue } from './types';
import type { PaintEngine } from '../PaintEngine';
import type { LayerParameterOp } from '../history/historyTree';

export class ParameterService {
  constructor(private engine: PaintEngine) {}

  private hosts(ids: string[]): { layer: Layer; host: ParameterHost }[] {
    return ids.flatMap(id => {
      const layer = this.engine.layerService.byId(id);
      return layer ? [{ layer, host: layer }] : [];
    });
  }

  private selectedIds(): string[] {
    const state = useStore.getState();
    return state.multiSelectMode ? state.selectedLayerIds : [this.engine.layerService.activeLayerId];
  }

  read(layer: ParameterHost, parameterId: string): ParameterValue {
    const parameter = parameterById(layer, parameterId);
    return parameter ? parameter.read(layer, layer.state) : null;
  }

  writeState(layer: Layer, parameterId: string, value: ParameterValue): void {
    const parameter = parameterById(layer, parameterId);
    if (!parameter) return;
    const patch = parameter.write(layer, layer.state, value);
    applyLayerProps(layer, patch);
  }

  writeRecord(host: ParameterHost, record: { apply(props: LayerProps): void }, parameterId: string, value: ParameterValue): void {
    const parameter = parameterById(host, parameterId);
    if (!parameter) return;
    record.apply(parameter.write(host, host.state, value));
  }

  preview(parameterId: string, value: ParameterValue): void {
    if (this.engine.isBusy()) return;
    for (const { layer } of this.hosts(this.selectedIds())) {
      this.writeState(layer, parameterId, value);
      this.engine.links.propagateFrom(this.engine.layerAddress(layer.id), true);
    }
    this.engine.requestRender();
    this.engine.syncStore();
  }

  commit(parameterId: string, value: ParameterValue, label?: string): void {
    this.commitRange(parameterId, undefined, value, label);
  }

  commitRange(parameterId: string, beforeValue: ParameterValue | undefined, value: ParameterValue, label = 'パラメータを変更'): void {
    if (this.engine.isBusy()) return;
    this.engine.events.emit('textCommitRequest');
    const ops: Array<LayerParameterOp | import('../history/historyTree').LayerLinkOp | import('../history/historyTree').AtomicOp> = [];
    for (const { layer } of this.hosts(this.selectedIds())) {
      const parameter = parameterById(layer, parameterId);
      if (!parameter) continue;
      const before = beforeValue !== undefined ? beforeValue : parameter.read(layer, layer.state);
      const beforeState = layerHandler(layer).state.clone(layer.state as never);
      const dataLinkOp = this.engine.layerService.detachDataLink(layer);
      this.writeState(layer, parameterId, value);
      this.engine.layerService.bumpLayer(layer.id);
      const after = parameter.read(layer, layer.state);
      const mixed = before === null && !editorAllowsNull(parameter);
      const afterProps: LayerProps = mixed && parameter.scope === 'state'
        ? layerTypeProps(layer)
        : parameter.write(layer, layer.state, after);
      const beforeProps: LayerProps = mixed && parameter.scope === 'state'
        ? { state: beforeState }
        : parameter.write(layer, layer.state, before);
      const historyOp = mixed && parameter.scope === 'state'
        ? { kind: 'layerProps' as const, layerId: layer.id, before: beforeProps, after: afterProps }
        : {
          kind: 'layerParameter' as const,
          layerId: layer.id,
          parameterId: parameter.id,
          before,
          after,
        };
      const linkOp = this.engine.layerService.linkOpForUserChange(layer, beforeProps, afterProps, true);
      ops.push(historyOp);
      if (linkOp) ops.push(linkOp);
      if (dataLinkOp) ops.push(dataLinkOp);
    }
    if (!ops.length) return;
    this.engine.history.push(ops.length === 1 ? ops[0] : { kind: 'batch', ops }, label);
    for (const { layer } of this.hosts(this.selectedIds())) {
      this.engine.links.propagateFrom(this.engine.layerAddress(layer.id));
    }
    this.engine.committed();
  }

  applyHistory(op: LayerParameterOp, value: ParameterValue): void {
    const layer = this.engine.layerService.byId(op.layerId);
    if (!layer) return;
    this.writeState(layer, op.parameterId, value);
    this.engine.layerService.bumpLayer(layer.id);
  }

  canonicalRead(host: ParameterHost, parameterId: string, ppi: number): ParameterValue {
    const parameter = parameterById(host, parameterId);
    return parameter ? toCanonical(parameter, parameter.read(host, host.state), ppi) : null;
  }

  canonicalWrite(host: ParameterHost, parameterId: string, value: ParameterValue, ppi: number): LayerProps {
    const parameter = parameterById(host, parameterId);
    if (!parameter) return {};
    return parameter.write(host, host.state, fromCanonical(parameter, value, ppi));
  }
}

export { applyRecordProps };
