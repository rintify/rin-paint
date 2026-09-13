import { useStore } from '../../state/store';
import { type Op, type LayerSnapshot } from '../history/historyTree';
import { layerHandler, savedLayerFrom, scaleStoredLayer, remapRecordIds } from '../layer-types/registry';
import {
  loadClipboard,
  saveClipboard,
  type LayerClipboard,
  type SavedLayer,
} from '../persistence/db';
import { CLIPBOARD_VERSION } from '../persistence/version';
import type { PaintEngine } from '../PaintEngine';

export class ClipboardService {
  constructor(private engine: PaintEngine) {}

  async copyLayers(menuLayerId?: string): Promise<void> {
    const eng = this.engine;
    const ls = eng.layerService;
    const st = useStore.getState();
    let ids = menuLayerId && (!st.multiSelectMode || !st.selectedLayerIds.includes(menuLayerId))
      ? [menuLayerId]
      : st.multiSelectMode ? st.selectedLayerIds : [menuLayerId ?? ls.activeLayerId];
    ids = ids.filter(id => !!ls.byId(id));
    const chosen = new Set(ids);
    const roots = ids.filter(id => {
      let parent = ls.byId(id)?.scopeId ?? null;
      while (parent) { if (chosen.has(parent)) return false; parent = ls.byId(parent)?.scopeId ?? null; }
      return true;
    });
    const allIds = new Set(roots.flatMap(id => ls.descendantIds(id)));
    const layers: SavedLayer[] = await Promise.all(
      ls.layers
        .filter(layer => allIds.has(layer.id))
        .map(async layer => {
          const record = await savedLayerFrom(layer, { pageFrame: eng.pageFrame, ppi: eng.getPageSpec().ppi });
          // Clipboard payloads are self-contained even when the occurrence links
          // to a Bin owner; a missing owner must never turn a paste transparent.
          if (!record.content && layer.dataLink && (layer.type === 'raster' || layer.type === 'image')) {
            record.content = await layerHandler(layer).codec.encodeContent?.(layer as never);
          }
          return { ...record, placement: { scopeId: layer.scopeId, scopeLayerIds: [...layer.scopeLayerIds] } };
        }),
    );
    const clipboard: LayerClipboard = {
      version: CLIPBOARD_VERSION,
      sourcePageId: eng.pages.activePageId,
      sourcePageIndex: Math.max(0, eng.pages.pageOrder.indexOf(eng.pages.activePageId)),
      sourcePpi: eng.getPageSpec().ppi,
      rootIds: roots,
      layers,
    };
    await saveClipboard(clipboard);
    useStore.getState().set({ clipboardAvailable: true });
  }

  async pasteLayers(): Promise<void> {
    const eng = this.engine;
    const ls = eng.layerService;
    if (eng.isBusy()) return;
    const clipboard = await loadClipboard();
    if (!clipboard?.layers.length) return;
    const factor = eng.getPageSpec().ppi / clipboard.sourcePpi;
    const ids = new Map<string, string>(clipboard.layers.map(layer => [layer.id, String(crypto.randomUUID())]));
    const snapshots: LayerSnapshot[] = [];
    for (const source of clipboard.layers) {
      const snapshot: LayerSnapshot = structuredClone({ ...source, content: source.content });
      remapRecordIds(snapshot, id => ids.get(id));
      const internalSource = source.common.parameterLink?.source;
      if (internalSource?.document.kind === 'page'
        && internalSource.document.id === clipboard.sourcePageId
        && ids.has(internalSource.nodeId)) {
        snapshot.common.parameterLink = {
          ...structuredClone(source.common.parameterLink!),
          source: {
            document: structuredClone(useStore.getState().editingDocument),
            scopePath: internalSource.scopePath.map(id => ids.get(id) ?? id),
            nodeId: ids.get(internalSource.nodeId)!,
          },
        };
      } else snapshot.common.parameterLink = undefined;
      await scaleStoredLayer(snapshot, { pageFrame: eng.pageFrame, factor });
      snapshots.push(snapshot);
    }
    const primaryLocation = ls.locationOf(ls.activeLayerId) ?? { scopeId: null, index: ls.rootLayerIds.length - 1 };
    const rootIds = clipboard.rootIds.map(id => ids.get(id)).filter((id): id is string => typeof id === 'string');
    const ops: Extract<Op, { kind: 'batch' }>['ops'] = [];
    const sourceById = new Map(clipboard.layers.map(layer => [layer.id, layer]));
    const sourceIdByNew = new Map([...ids].map(([oldId, newId]) => [newId, oldId]));
    const pending = [...snapshots];
    while (pending.length) {
      const index = pending.findIndex(snapshot => !snapshot.placement?.scopeId || !!ls.byId(snapshot.placement.scopeId));
      if (index < 0) break;
      const [snapshot] = pending.splice(index, 1);
      const source = sourceById.get(sourceIdByNew.get(snapshot.id)!)!;
      const isRoot = rootIds.includes(snapshot.id);
      const location = isRoot
        ? { scopeId: primaryLocation.scopeId, index: primaryLocation.index + 1 + rootIds.indexOf(snapshot.id) }
        : { scopeId: snapshot.placement?.scopeId ?? null, index: source.placement?.scopeId ? sourceById.get(source.placement.scopeId)?.placement?.scopeLayerIds.indexOf(source.id) ?? 0 : 0 };
      snapshot.placement = { scopeId: location.scopeId, scopeLayerIds: [] };
      const restored = await ls.restoreLayer(snapshot, location);
      if (!restored) continue;
      const sourceScopePath: string[] = [];
      let sourceCursor = source;
      while (sourceCursor.placement?.scopeId) {
        sourceScopePath.unshift(sourceCursor.placement.scopeId);
        const parent = sourceById.get(sourceCursor.placement.scopeId);
        if (!parent) break;
        sourceCursor = parent;
      }
      if (!snapshot.common.parameterLink) eng.links.createPasteLink(
          restored.id,
          { document: { kind: 'page', id: clipboard.sourcePageId }, scopePath: sourceScopePath, nodeId: source.id },
          { name: source.common.name, pageIndex: clipboard.sourcePageIndex },
        );
      // Redo must restore the values and direct source chosen at paste time. Keep the
      // original raster blob while refreshing all ordinary/link fields from the live copy.
      Object.assign(snapshot, ls.snapshotLayer(restored, false));
      ops.push({ kind: 'layerAdd', snapshot, location });
    }
    ls.activeLayerId = rootIds.at(-1) ?? ls.activeLayerId;
    useStore.getState().set({ multiSelectMode: rootIds.length > 1, selectedLayerIds: rootIds });
    eng.history.push({ kind: 'batch', ops }, 'レイヤーをペースト');
    eng.committed();
  }
}
