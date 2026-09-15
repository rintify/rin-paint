import { useStore } from '../../state/store';
import { type Op, type LayerSnapshot } from '../history/historyTree';
import { savedLayerFrom, scaleStoredLayer, remapRecordIds } from '../layer-types/registry';
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
      let parent = ls.byId(id)?.parentId ?? null;
      while (parent) { if (chosen.has(parent)) return false; parent = ls.byId(parent)?.parentId ?? null; }
      return true;
    });
    const allIds = new Set(roots.flatMap(id => ls.descendantIds(id)));
    const layers: SavedLayer[] = await Promise.all(
      ls.layers
        .filter(layer => allIds.has(layer.id))
        .map(layer => savedLayerFrom(layer, { artboard: eng.artboard })),
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
      const existingLink = snapshot.common.parameterLink;
      const remappedSourceId = existingLink?.source.pageId === clipboard.sourcePageId
        ? ids.get(existingLink.source.layerId)
        : undefined;
      if (existingLink && remappedSourceId) {
        existingLink.source = {
          pageId: eng.pages.activePageId,
          layerId: remappedSourceId,
        };
        existingLink.sourcePageIndexHint = Math.max(
          0,
          eng.pages.pageOrder.indexOf(eng.pages.activePageId),
        );
      }
      await scaleStoredLayer(snapshot, { artboard: eng.artboard, factor });
      snapshots.push(snapshot);
    }
    const primaryLocation = ls.locationOf(ls.activeLayerId) ?? { parentId: null, index: ls.rootLayerIds.length - 1 };
    const rootIds = clipboard.rootIds.map(id => ids.get(id)).filter((id): id is string => typeof id === 'string');
    const ops: Extract<Op, { kind: 'batch' }>['ops'] = [];
    const sourceById = new Map(clipboard.layers.map(layer => [layer.id, layer]));
    const sourceIdByNew = new Map([...ids].map(([oldId, newId]) => [newId, oldId]));
    const autoLinkOnPaste = useStore.getState().autoLinkOnPaste;
    const pending = [...snapshots];
    while (pending.length) {
      const index = pending.findIndex(snapshot => !snapshot.common.parentId || !!ls.byId(snapshot.common.parentId));
      if (index < 0) break;
      const [snapshot] = pending.splice(index, 1);
      const source = sourceById.get(sourceIdByNew.get(snapshot.id)!)!;
      const isRoot = rootIds.includes(snapshot.id);
      const location = isRoot
        ? { parentId: primaryLocation.parentId, index: primaryLocation.index + 1 + rootIds.indexOf(snapshot.id) }
        : { parentId: snapshot.common.parentId, index: source.common.parentId ? sourceById.get(source.common.parentId)?.common.childIds.indexOf(source.id) ?? 0 : 0 };
      snapshot.common.parentId = location.parentId;
      snapshot.common.childIds = [];
      const restored = await ls.restoreLayer(snapshot, location);
      if (!restored) continue;
      if (autoLinkOnPaste && !snapshot.common.parameterLink) {
        eng.links.createPasteLink(
          restored.id,
          { pageId: clipboard.sourcePageId, layerId: source.id },
          { name: source.common.name, pageIndex: clipboard.sourcePageIndex },
        );
      }
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
