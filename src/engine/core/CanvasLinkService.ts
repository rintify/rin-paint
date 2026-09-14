import { inheritedOccurrenceId } from '../parameters/inheritedOccurrence';
import { layerChildren } from '../layerTree';
import { savedLayerFrom, commonRecordFrom, layerDefinition } from '../layer-types/registry';
import type { LayerAddress } from '../../model';
import type { Layer } from '../layers';
import type { PaintEngine } from '../PaintEngine';
import type { AtomicOp, Op, LayerLinkOp, LayerLocation } from '../history/historyTree';
import { linkableParameterMap } from '../layerParameters';

export interface CanvasLinkOverlay {
  inherited: Record<string, string>;
  suppressed: string[];
  placements: {id: string; index: number}[];
}
const same = (a: LayerAddress, b: LayerAddress) => a.layerId === b.layerId && a.document.kind === b.document.kind && a.document.id === b.document.id;

/** Resolves canvas structure separately from the fields and content of each child occurrence. */
export class CanvasLinkService {
  private pending: Promise<void> = Promise.resolve();
  private running = false;
  private lastError: unknown;
  constructor(private readonly engine: PaintEngine) {}

  initialize(target: Layer, source: LayerAddress): CanvasLinkOverlay {
    const sourceRecord = this.engine.links.sourceRecord(source);
    const inherited: Record<string, string> = {};
    for (const child of sourceRecord?.scope?.children ?? []) {
      const existing = layerChildren(target).find(id => id === child.id || (() => {
        const link = this.engine.layerService.byId(id)?.parameterLink;
        return link && same(link.source, {document: source.document, layerId: child.id});
      })());
      if (existing) inherited[child.id] = existing;
    }
    return {inherited, suppressed: [], placements: []};
  }

  reconcile(): Promise<void> {
    const document = {...this.engine.documentKey};
    const operation = this.pending.catch(() => undefined).then(async () => {
      if (document.kind !== this.engine.documentKey.kind || document.id !== this.engine.documentKey.id) return;
      this.running = true; this.lastError=undefined;
      try { await this.resolveDocument(document); } finally {this.running = false;}
    });
    this.pending = operation.catch(error => {this.lastError=error; this.engine.notify(`キャンバスの参照更新に失敗しました: ${String(error)}`);});
    return this.pending;
  }
  async flush(): Promise<void> { await this.pending; if (this.lastError) throw this.lastError; }

  private async resolveDocument(document: LayerAddress['document']): Promise<void> {
    const eng = this.engine, ls = eng.layerService;
    let changed = false;
    const resolved = new Set<string>();
    const resolve = async (id: string): Promise<void> => {
      if (resolved.has(id)) return;
      resolved.add(id);
      const canvas = ls.byId(id);
      if (canvas?.type !== 'canvas') return;
      const link = canvas.parameterLink, overlay = link?.structure;
      if (link && overlay) {
        if (link.source.document.kind === document.kind && link.source.document.id === document.id) await resolve(link.source.layerId);
        const source = eng.links.sourceRecord(link.source);
        if (source?.type === 'canvas') {
          const sourceIds = source.scope?.children.map(child => child.id) ?? [];
          for (const sourceId of sourceIds) {
            if (overlay.inherited[sourceId]) continue;
            overlay.inherited[sourceId] = canvas.childIds.find(id => {
              const childLink = ls.byId(id)?.parameterLink;
              return childLink && same(childLink.source, {document: link.source.document, layerId: sourceId});
            }) ?? inheritedOccurrenceId(canvas.id, sourceId);
            changed = true;
          }
          const inheritedIds = new Set(Object.values(overlay.inherited));
          const local = canvas.childIds.filter(id => !inheritedIds.has(id));
          const desired: string[] = [];
          for (const sourceId of sourceIds) {
            if (overlay.suppressed.includes(sourceId)) {
              const suppressedId = overlay.inherited[sourceId];
              if (ls.scopeOf(suppressedId) === canvas.id) {ls.removeLayerInternal(suppressedId); changed = true;}
              continue;
            }
            const childId = overlay.inherited[sourceId];
            if (!ls.byId(childId)) {
              const childSource = {document: link.source.document, layerId: sourceId};
              const original = eng.links.sourceRecord(childSource);
              if (!original) continue;
              const snapshot = {...original, id: childId, common: {...original.common, parameterLink: undefined},
                ...(original.scope ? {scope: {id: childId, children: []}} : {})};
              const restored = await ls.restoreLayer(snapshot, {parentId: canvas.id, index: canvas.childIds.length});
              if (document.kind !== eng.documentKey.kind || document.id !== eng.documentKey.id) return;
              if (!restored) continue;
              eng.links.createPasteLink(childId, childSource);
              changed = true;
            }
            const child = ls.byId(childId), original = eng.links.sourceRecord({document: link.source.document, layerId: sourceId});
            if (child && original && !child.parameterLink?.stateOverrides?.['/maskLayerIds'] && original.state && typeof original.state === 'object' && 'maskLayerIds' in original.state) {
              const adapter = layerDefinition(child.type).state;
              if (adapter.remapReferences) {
                const state = adapter.remapReferences(original.state as never, id => overlay.inherited[id] ?? id);
                const masks = (state as {maskLayerIds?: string[]}).maskLayerIds;
                if (masks && JSON.stringify((child.state as {maskLayerIds?: string[]}).maskLayerIds) !== JSON.stringify(masks)) {
                  (child.state as {maskLayerIds?: string[]}).maskLayerIds = masks; changed = true;
                }
              }
            }
            desired.push(childId);
          }
          for (const [sourceId, childId] of Object.entries(overlay.inherited)) {
            if (sourceIds.includes(sourceId)) continue;
            const child = ls.byId(childId);
            if (!child) continue;
            if (this.hasOverrides(child)) {
              this.materialize(childId); local.push(childId); delete overlay.inherited[sourceId];
            } else ls.removeLayerInternal(childId);
            changed = true;
          }
          desired.push(...local.filter(id => !!ls.byId(id)));
          for (const placement of overlay.placements) {
            const index = desired.indexOf(placement.id); if (index < 0) continue;
            desired.splice(index, 1); desired.splice(Math.min(placement.index, desired.length), 0, placement.id);
          }
          if (JSON.stringify(desired) !== JSON.stringify(canvas.childIds)) {canvas.childIds = desired; changed = true;}
        } else {
          this.materialize(canvas.id); changed = true;
        }
      }
      for (const child of [...canvas.childIds]) await resolve(child);
    };
    for (const root of [...ls.rootLayerIds]) await resolve(root);
    if (changed) {
      eng.links.reconcileAll(); eng.stacks.normalize(); eng.requestRender(); eng.syncStore(); eng.scheduleSave();
    }
  }

  async saveOccurrence(layer: Layer): Promise<import('../persistence/db').SavedLayer> {
    const owner=this.engine.layerService.byId(this.engine.layerService.scopeOf(layer.id) ?? '');
    const inherited=owner?.type === 'canvas' && Object.values(owner.parameterLink?.structure?.inherited ?? {}).includes(layer.id);
    if (inherited && !this.hasOverrides(layer)) {
      return {id:layer.id,type:layer.type,unit:'mm',referenceOnly:true,common:commonRecordFrom(layer),state:{},
        ...(layer.type === 'canvas' ? {scope:{id:layer.id,children:layer.childIds.map(id=>({id,entityId:id}))}} : {})};
    }
    return savedLayerFrom(layer,{artboard:this.engine.artboard,ppi:this.engine.getPageSpec().ppi});
  }

  private hasOverrides(layer: Layer): boolean {
    const link = layer.parameterLink;
    if (!link || !link.linkedState || !link.linkedName || Object.keys(link.stateOverrides ?? {}).length) return true;
    if ((layer.type === 'raster' || layer.type === 'image') && !link.linkedContent) return true;
    if ([...linkableParameterMap(layer).keys()].some(id => !link.linkedParameterIds.includes(id))) return true;
    if (layer.type === 'canvas') {
      const structure = link.structure;
      if (!structure || structure.suppressed.length || structure.placements.length) return true;
      const inherited = new Set(Object.values(structure.inherited));
      if (layer.childIds.some(id => !inherited.has(id))) return true;
      return layer.childIds.some(id => {const child = this.engine.layerService.byId(id); return child ? this.hasOverrides(child) : false;});
    }
    return false;
  }

  private materialize(id: string): void {
    const ls = this.engine.layerService;
    for (const childId of ls.descendantIds(id)) {
      const child = ls.byId(childId); if (!child) continue;
      this.engine.links.freezeLayer(childId);
    }
  }

  private change(canvasId: string | null, mutate: (structure: CanvasLinkOverlay) => void): LayerLinkOp | null {
    if (this.running || !canvasId) return null;
    const canvas = this.engine.layerService.byId(canvasId), link = canvas?.parameterLink;
    if (canvas?.type !== 'canvas' || !link?.structure) return null;
    const before = structuredClone(link); mutate(link.structure);
    if (JSON.stringify(before) === JSON.stringify(link)) return null;
    return {kind: 'layerLink', target: {document: this.engine.documentKey, layerId: canvasId}, before, after: structuredClone(link)};
  }

  suppress(id: string, scopeId: string | null): LayerLinkOp | null {
    return this.change(scopeId, structure => {
      const source = Object.entries(structure.inherited).find(([, target]) => target === id)?.[0];
      if (source && !structure.suppressed.includes(source)) structure.suppressed.push(source);
    });
  }

  move(id: string, from: LayerLocation, to: LayerLocation): LayerLinkOp[] {
    const result: LayerLinkOp[] = [];
    if (from.parentId !== to.parentId) {const op = this.suppress(id, from.parentId); if (op) result.push(op);}
    const placement = this.change(to.parentId, structure => {structure.placements.push({id, index: to.index});});
    if (placement) result.push(placement);
    return result;
  }

  capture(op: Op): Op {
    if (this.running) return op;
    const operations = op.kind === 'batch' ? op.ops : [op];
    const additions: AtomicOp[] = [];
    for (const operation of operations) {
      const entries = operation.kind === 'layerAdd' ? [{id: operation.snapshot.id, location: operation.location}]
        : operation.kind === 'layerReplace' ? operation.after.entries.filter(entry => !operation.before.entries.some(before => before.snapshot.id === entry.snapshot.id)).map(entry => ({id: entry.snapshot.id, location: entry.location})) : [];
      for (const entry of entries) {
        const change = this.change(entry.location.parentId, structure => {
          structure.placements.push({id: entry.id, index: entry.location.index});
        });
        if (change) additions.push(change);
      }
    }
    return additions.length ? {kind: 'batch', ops: [...operations, ...additions]} : op;
  }

  restoreChild(canvasId: string, sourceId: string): void {
    const op = this.change(canvasId, structure => {structure.suppressed = structure.suppressed.filter(id => id !== sourceId);});
    if (op) {this.engine.history.push(op, '元の子を復元'); this.engine.committed();}
  }
}
