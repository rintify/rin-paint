import type { SavedPage } from '../persistence/db';
import { findLayerModule, inspectLayerRecord } from '../layer-types/registry';
import type { PageOwned } from './types';

/** Decode owned data once, retaining unsupported records without normalization. */
export function pageOwnedFromSaved(page: SavedPage): PageOwned {
  const results = page.layers.map(inspectLayerRecord);
  const failures = results.filter(result => result.status !== 'ok');
  return {
    id: page.id,
    spec: { ...page.pageSpec },
    rootLayerIds: [...page.rootLayerIds],
    activeLayerId: page.activeLayerId,
    layers: page.layers.map((layer, index) => {
      const mod = findLayerModule(layer.kindId || layer.type);
      const loaded = results[index];
      return {
        ...layer,
        kindId: layer.kindId ?? mod?.kindId ?? `rin.layer.${layer.type}`,
        revision: loaded.status === 'ok' ? mod!.revision : (layer.revision ?? 1),
        common: structuredClone(layer.common),
        state: loaded.status === 'ok' ? loaded.value : structuredClone(layer.state),
      };
    }),
    history: page.history,
    view: { ...page.view },
    thumbnailVersion: page.thumbnailVersion,
    thumbnail: page.thumbnail,
    status: failures.some(result => result.status === 'invalid') ? 'invalid' : failures.length ? 'unsupported' : 'ok',
    reasons: failures.map(result => result.reason),
    raw: failures.length ? structuredClone(page) : undefined,
  };
}
