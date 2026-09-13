import type { LayerMeta } from '../../model';
import { hostFromLayer } from '../../engine/parameters/host';
import { parameterById } from '../../engine/parameters/host';
import type { ParameterValue, ResolvedParameter } from '../../engine/parameters/types';
import { useEngine } from '../EngineContext';
import { useStore } from '../../state/store';
import { ParameterLinkIndicator } from './ParameterLinkIndicator';
import { linkedParameterColor } from './parameterLinkUi';
import { renderParameterControl } from './controlRenderers';

export function ParameterField({
  parameter,
  layers,
}: {
  parameter: ResolvedParameter;
  layers: LayerMeta[];
}) {
  const engine = useEngine();
  const fonts = useStore(s => s.fonts);
  const ppi = useStore(s => s.canvasSpec.ppi);
  const values = layers.map(layer => {
    const own = parameterById(hostFromLayer(layer), parameter.semanticId) ?? parameter;
    return own.read(layer, layer.state);
  });
  const mixed = values.some(value => !Object.is(value, values[0]));
  const value = mixed ? null : values[0];
  const linkedLayers = layers.filter(layer => layer.parameterLink?.linkedParameterIds.includes(parameter.semanticId));
  const labelColor = linkedLayers.length === layers.length
    ? 'secondary'
    : linkedLayers.length
      ? 'warning.main'
      : linkedParameterColor(layers[0], parameter.semanticId);
  const commit = (next: ParameterValue) => engine.updateSelectedParameter(parameter.semanticId, next as never);
  return renderParameterControl({
    parameter,
    value,
    mixed,
    labelColor,
    fonts,
    ppi,
    trailing: layers.length === 1
      ? <ParameterLinkIndicator meta={layers[0]} semanticId={parameter.semanticId} />
      : linkedLayers.length
        ? <ParameterLinkIndicator meta={linkedLayers[0]} semanticId={parameter.semanticId} />
        : null,
    onCommit: commit,
    onPreview: next => engine.previewSelectedParameter(parameter.semanticId, next as never),
    onCommitRange: (before, after) => engine.commitSelectedParameterPreview(parameter.semanticId, before as never, after as never),
  });
}
