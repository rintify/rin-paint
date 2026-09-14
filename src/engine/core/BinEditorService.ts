import { recordLocation } from '../layer-types/scopes';
import { useStore } from '../../state/store';
import { HistoryTree, type AtomicOp } from '../history/historyTree';
import { savedLayerFrom, remapRecordIds } from '../layer-types/registry';
import { layerMaskIds } from '../layer-types/definition';
import { loadBins, loadPage, saveBin, deleteBinData, type SavedBin, type SavedPage } from '../persistence/db';
import type { PaintEngine } from '../PaintEngine';

/** Assets never own a page address; the editor remembers the return page separately. */
export class BinEditorService {
  activeId: string | null = null;
  items: SavedBin[] = [];
  constructor(private readonly engine: PaintEngine) {}
  async load(): Promise<void> {this.items = await loadBins(); this.publish();}
  noteSaved(item: SavedBin): void {
    this.items = [...this.items.filter(existing => existing.id !== item.id), item]; this.publish();
  }
  reset(): void {this.activeId = null; this.items = []; this.publish();}
  private publish(): void {
    useStore.getState().set({activeBinId: this.activeId, binItems: this.items.map(item => ({id: item.id,
      name: item.layers.find(layer => layer.id === item.rootLayerIds[0])?.common.name ?? '素材'}))});
  }
  async remove(id:string):Promise<void> {
    const eng=this.engine;
    if(eng.isBusy())return;
    if(this.activeId===id)await this.returnToPage();
    await eng.flushSavePublic();
    const item=this.items.find(item=>item.id===id);if(!item)return;
    eng.links.archiveRemoval(item.layers.map(layer=>layer.id),{kind:'bin-item',id});
    this.items=this.items.filter(item=>item.id!==id);this.publish();
    eng.links.reconcileAll();await eng.canvases.reconcile();await eng.links.flush();
    await eng.pages.saveMeta();await deleteBinData(id);
    eng.requestRender();eng.syncStore();eng.scheduleSave();
  }
  async register(layerId: string): Promise<void> {
    const eng = this.engine, ls = eng.layerService;
    if (this.activeId || eng.isBusy()) return;
    ls.finishFloating();
    const root = ls.byId(layerId);
    if (!root) return;
    await eng.flushSavePublic();
    const ids = new Set(ls.descendantIds(layerId));
    const id = crypto.randomUUID(), document = {kind: 'bin-item' as const, id};
    const layers = await Promise.all([...ids].map(async layerId => savedLayerFrom(ls.byId(layerId)!, {artboard: eng.artboard, ppi: eng.getPageSpec().ppi})));
    for (const layer of layers) {
      delete layer.common.linkRecovery;
      const link = layer.common.parameterLink;
      if (link?.source.document.kind === 'page') {
        if (link.source.document.id === eng.pages.activePageId && ids.has(link.source.layerId)) link.source.document = document;
        else delete layer.common.parameterLink;
      }
      const masks = layerMaskIds(layer.state);
      if (masks.length && layer.state && typeof layer.state === 'object') {
        (layer.state as {maskLayerIds: string[]}).maskLayerIds = masks.filter(mask => ids.has(mask));
      }
    }
    const item: SavedBin = {id, rootLayerIds: [layerId], layers, activeLayerId: layerId,
      workArea: {...eng.getPageSpec()}, view: eng.view.snapshot(), history: await new HistoryTree().serialize()};
    // Registration is durable before the page starts referencing it.
    await saveBin(item); this.noteSaved(item); eng.links.reconcileAll(); await eng.links.flush();
    const ops: AtomicOp[] = [];
    for (const source of layers) {
      const layer = ls.byId(source.id)!;
      ops.push(...eng.links.captureLocalRestoreOps(layer));
      const before = layer.parameterLink ? structuredClone(layer.parameterLink) : null;
      eng.links.createPasteLink(layer.id, {document, layerId: source.id});
      ops.push({kind: 'layerLink', target: {document: eng.documentKey, layerId: layer.id}, before,
        after: layer.parameterLink ? structuredClone(layer.parameterLink) : null});
    }
    eng.history.push({kind: 'batch', ops}, 'ビン素材を参照'); eng.committed();
  }
  private pageFor(item: SavedBin): SavedPage {
    return {id: item.id, rootLayerIds: item.rootLayerIds, layers: item.layers, activeLayerId: item.activeLayerId,
      history: item.history, view: item.view, selection: item.selection, pageSpec: item.workArea, thumbnailVersion: 0};
  }
  async open(id: string): Promise<void> {
    const eng = this.engine;
    if (eng.isBusy() || this.activeId === id) return;
    let item = this.items.find(item => item.id === id); if (!item) return;
    if (!this.activeId) {
      const page = eng.getPageSpec();
      item = {...item, workArea: {...item.workArea, widthMm: page.widthMm, heightMm: page.heightMm}};
      this.noteSaved(item);
    }
    eng.layerService.finishFloating(); eng.cancelSessions();
    await eng.flushSavePublic();
    await eng.recorderPublic().reset();
    this.activeId = id;
    await eng.restoreSavedPagePublic(this.pageFor(item));
    eng.stacks.restore([]); eng.links.reconcileAll();
    await eng.canvases.reconcile();
    this.publish(); eng.events.emit('projectReset'); eng.requestRender(); eng.syncStore();
    await eng.pages.saveMeta();
  }
  async returnToPage(): Promise<void> {
    if (!this.activeId) return;
    const eng = this.engine;
    eng.layerService.finishFloating(); eng.cancelSessions();
    await eng.flushSavePublic();
    const page = await loadPage(eng.pages.activePageId);
    if (!page) throw new Error('戻り先のページがありません');
    this.activeId = null;
    await eng.restoreSavedPagePublic(page); eng.links.reconcileAll();
    await eng.canvases.reconcile();
    this.publish(); eng.events.emit('projectReset'); eng.requestRender(); eng.syncStore();
    await eng.pages.saveMeta();
  }
  async addToPage(id: string, targetLayerId?: string): Promise<void> {
    await this.returnToPage();
    const eng = this.engine, ls = eng.layerService;
    const item = this.items.find(item => item.id === id); if (!item || eng.isBusy()) return;
    ls.finishFloating();
    const mapping = new Map(item.layers.map(layer => [layer.id, crypto.randomUUID()]));
    const scope = ls.scopeOf(targetLayerId ?? ls.activeLayerId);
    const index = ls.siblingIds(scope).length;
    const ops: AtomicOp[] = [];
    for (const source of item.layers) {
      const snapshot = structuredClone(source);
      remapRecordIds(snapshot, id => mapping.get(id));
      const isRoot = item.rootLayerIds.includes(source.id);
      const originalLocation = recordLocation(item.layers, source.id);
      const location = {parentId: isRoot ? scope : mapping.get(originalLocation.parentId!) ?? null,
        index: isRoot ? index : originalLocation.index};
      if (snapshot.scope) snapshot.scope.children = [];
      const layer = await ls.restoreLayer(snapshot, location); if (!layer) continue;
      eng.links.createPasteLink(layer.id, {document: {kind: 'bin-item', id}, layerId: source.id});
      Object.assign(snapshot, ls.snapshotLayer(layer, false));
      ops.push({kind: 'layerAdd', snapshot, location});
    }
    ls.activeLayerId = mapping.get(item.rootLayerIds[0])!;
    eng.history.push({kind: 'batch', ops}, 'ビン素材のリンクを追加');
    eng.setActiveLayer(ls.activeLayerId); eng.committed();
  }
}
