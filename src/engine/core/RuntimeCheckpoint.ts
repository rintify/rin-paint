import type { PaintEngine } from '../PaintEngine';
import type { Layer } from '../layers';
import { useStore } from '../../state/store';

export function cloneRuntimeLayers(source: Layer[]): Layer[] {
  return source.map((layer) => {
    const { runtime, ...metadata } = layer as Layer & { runtime?: object };
    return {
      ...structuredClone(metadata),
      ...(runtime
        ? {
            runtime:
              layer.type === 'raster'
                ? { surface: layer.runtime.surface.clone() }
                : { ...runtime },
          }
        : {}),
    };
  }) as Layer[];
}

/** Synchronous rollback with shared immutable pixels; recovery needs no PNG decoding. */
export function runtimeCheckpoint(engine: PaintEngine): () => void {
  const service = engine.layerService;
  const layers = cloneRuntimeLayers(service.layers);
  const roots = [...service.rootLayerIds],
    active = service.activeLayerId;
  const spec = { ...engine.getPageSpec() },
    view = engine.view.snapshot();
  const state = useStore.getState(),
    selection = {
      selectedLayerIds: [...state.selectedLayerIds],
      multiSelectMode: state.multiSelectMode,
      selectionActive: state.selectionActive,
    };
  return () => {
    service.layers = layers;
    service.rootLayerIds = roots;
    service.activeLayerId = active;
    engine.project.restoreRuntimePageSpec(spec);
    engine.view.restore(view);
    service.clearVersions();
    useStore.getState().set(selection);
    engine.requestRender();
    engine.syncStore();
  };
}
