import { useStore } from '../../state/store';
import type { Layer } from '../layers';
import { applyLayerProps, applyRecordProps, layerTypeProps } from '../layer-types/registry';
import type { LayerProps } from '../layer-types/definition';
import { fromCanonical, toCanonical } from './codec';
import { parameterById, type ParameterHost } from './host';
import type { ParameterValue } from './types';
import type { PaintEngine } from '../PaintEngine';
import { EditSession } from '../editing/EditSession';

export class ParameterService {
  private session = new EditSession();

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

  private selectedLayers(): Layer[] {
    return this.hosts(this.selectedIds()).map(item => item.layer);
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

  private beginIfNeeded(): void {
    if (!this.session.active) this.session.begin(this.selectedLayers());
  }

  preview(parameterId: string, value: ParameterValue): void {
    if (this.engine.isBusy()) return;
    this.beginIfNeeded();
    for (const { layer } of this.hosts(this.selectedIds())) {
      const start = this.session.startProps(layer.id);
      this.writeState(layer, parameterId, value);
      const linkOp = start
        ? this.engine.layerService.linkOpForUserChange(layer, start, {
            opacity: layer.opacity,
            visible: layer.visible,
            blend: layer.blend,
            ...layerTypeProps(layer),
          })
        : null;
      if (linkOp) applyLayerProps(layer, { parameterLink: linkOp.after });
      this.engine.links.propagateFrom({ pageId: this.engine.pages.activePageId, layerId: layer.id }, true);
    }
    this.engine.requestRender();
    this.engine.syncStore();
  }

  commit(parameterId: string, value: ParameterValue, label?: string): void {
    this.commitRange(parameterId, undefined, value, label);
  }

  commitRange(parameterId: string, _beforeValue: ParameterValue | undefined, value: ParameterValue, label = 'パラメータを変更'): void {
    if (this.engine.isBusy()) return;
    this.engine.events.emit('textCommitRequest');
    this.beginIfNeeded();
    for (const { layer } of this.hosts(this.selectedIds())) {
      this.writeState(layer, parameterId, value);
      this.engine.layerService.bumpLayer(layer.id);
    }
    const layers = this.selectedLayers();
    this.session.commit(layers, this.engine.history, label);
    for (const layer of layers) {
      this.engine.links.propagateFrom({ pageId: this.engine.pages.activePageId, layerId: layer.id });
    }
    this.engine.committed();
  }

  cancelPreview(): void {
    if (!this.session.active) return;
    this.session.cancel(this.selectedLayers());
    this.engine.requestRender();
    this.engine.syncStore();
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
