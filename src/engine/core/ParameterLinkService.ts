import { inheritedOccurrenceId } from '../parameters/inheritedOccurrence';
import { stateChanges, applyStateOverrides } from '../parameters/stateOverrides';
import { RasterSurface } from '../raster/RasterSurface';
import type { SparseRasterSnapshot } from '../raster/SparseRaster';
import type {
  LayerAddress,
  LayerLinkEndpointSummary,
  LayerParameterLink,
  SemanticParameterValue,
} from '../../model';
import { useStore } from '../../state/store';
import {
  linkableParameterMap,
  parameterValuesEqual,
  readCanonicalParameter,
  writeCanonicalParameter,
} from '../layerParameters';
import type { Layer } from '../layers';
import { applyLayerProps, applyRecordProps, layerTypeProps, layerDefinition, commonRecordFrom } from '../layer-types/registry';
import type { LayerProps } from '../layer-types/definition';
import { hostFromRecord, parameterById, type ParameterHost } from '../parameters/host';
import { loadPage, savePage, saveBin, type SavedLayer, type SavedPage, type SavedProjectMeta } from '../persistence/db';
import type { PaintEngine } from '../PaintEngine';

export interface LayerLinkCandidate {
  address: LayerAddress;
  name: string;
  pageIndex: number;
  type: string;
  compatibleCount: number;
  equalCount: number;
  disabledReason?: string;
}

interface RecordEntry {
  address: LayerAddress;
  host: ParameterHost;
  ppi: number;
  live: boolean;
  liveLayer?: Layer;
  stored?: SavedLayer;
}

function addrKey(address: LayerAddress): string {
  return `${address.document.kind}:${address.document.id}:${address.layerId}`;
}

function sameAddress(a: LayerAddress, b: LayerAddress): boolean {
  return a.document.kind === b.document.kind && a.document.id === b.document.id && a.layerId === b.layerId;
}

function cloneLink(link: LayerParameterLink | undefined | null): LayerParameterLink | null {
  return link ? structuredClone(link) : null;
}

/** Owns the parameter graph; live layer values are resolved on read, never pushed into other pages. */
export class ParameterLinkService {
  private pages = new Map<string, SavedPage>();
  private deleted = new Map<string, {address: LayerAddress; layer: import('../layer-types/definition').LayerSnapshot}>();
  private resolvingDeleted = false;
  private virtualEntries = new Map<string,RecordEntry>();
  private resolvingScopes = new Set<string>();

  restoreDeletedSources(records: SavedProjectMeta['deletedSources'] = []): void {
    this.deleted = new Map(records.map(record=>[addrKey(record.address),record]));
    for (const {layer} of records) {
      if (layer.content && layer.type === 'raster') this.prepareRasterContent(layer.content);
      if (layer.content && layer.type === 'image') this.prepareImageContent(layer.content);
    }
  }
  async serializeDeletedSources(): Promise<NonNullable<SavedProjectMeta['deletedSources']>> {
    const needed=new Set<string>();
    const scan=(value:unknown):void=>{
      if (!value || typeof value !== 'object' || value instanceof Blob || ArrayBuffer.isView(value) || value instanceof Map
        || typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) return;
      if (Array.isArray(value)) {value.forEach(scan);return;}
      const object=value as Record<string,unknown>, source=object.source as LayerAddress | undefined;
      if (source?.document && typeof source.layerId === 'string') needed.add(addrKey(source));
      for (const [key,item] of Object.entries(object)) if (!['raster','canvas','image','parent','children'].includes(key)) scan(item);
    };
    for (const entry of this.collectRecords()) {scan(entry.host.parameterLink);scan(entry.host.linkRecovery);}
    for (const page of this.pages.values()) scan(page.history);
    for (const bin of this.engine.bins.items) scan(bin.history);
    const history=(node:import('../history/historyTree').HistoryNode):void=>{scan(node.op);node.children.forEach(history);};
    history(this.engine.history.root);
    for (const key of needed) {
      const record=this.deleted.get(key);
      for (const child of record?.layer.scope?.children ?? []) needed.add(addrKey({document:record!.address.document,layerId:child.id}));
    }
    for (const key of this.deleted.keys()) if (!needed.has(key)) this.deleted.delete(key);
    const records = [...this.deleted.values()];
    return Promise.all(records.map(async ({address,layer}) => {
      const {raster,image,...record}=layer;
      if (image) record.content=await image.encode();
      if (raster) record.content=await new RasterSurface(raster.intrinsicPpi,raster).encode();
      return {address:structuredClone(address),layer:record};
    }));
  }

  /** Called before removing ownership, while every downstream effective value can still be read. */
  archiveRemoval(ids: readonly string[], document = this.engine.documentKey): void {
    this.rebuildIndex();
    const pendingIds=new Set(ids);
    for (const id of pendingIds) {
      const address={document:{...document},layerId:id}, snapshot=this.sourceRecord(address);
      if (!snapshot) continue;
      for (const child of snapshot.scope?.children ?? []) pendingIds.add(child.id);
      const layer={...snapshot,common:{...snapshot.common,parameterLink:undefined},state:structuredClone(snapshot.state)};
      this.deleted.set(addrKey(address),{address,layer});
    }
    // A consumer's rendered view must capture the last source revision before ownership changes.
    for (const entry of this.records()) if (entry.liveLayer) this.resolveLayer(entry.liveLayer);
  }

  private signature(entry: RecordEntry): string {
    const host=entry.host;
    return JSON.stringify([host.name,host.opacity,host.blend,host.visible,host.state,
      entry.liveLayer?.type === 'canvas' ? entry.liveLayer.childIds : entry.stored?.scope?.children.map(child=>child.id)]);
  }

  freezeLayer(id: string): void {
    this.rebuildIndex();
    const entry=this.find(this.currentAddress(id)); if (entry) this.freezeEntry(entry);
  }

  private freezeEntry(entry: RecordEntry): void {
    const link=entry.host.parameterLink;
    if (!link || entry.host.linkRecovery) return;
    const before=structuredClone(link);
    this.resolvingDeleted=true;
    try {
      if (entry.liveLayer) {
        this.resolveLayer(entry.liveLayer);
        if (entry.liveLayer.type === 'raster') entry.liveLayer.runtime.surface.unbind();
      } else if (entry.stored) {
        const props: LayerProps={};
        if (link.linkedState) props.state=this.effectiveState(entry);
        if (link.linkedName) props.name=this.effectiveName(entry.address);
        applyRecordProps(entry.stored,props); entry.host=hostFromRecord(entry.stored);
        for (const id of link.linkedParameterIds) {
          const descriptor=linkableParameterMap(entry.host).get(id), value=this.canonicalValue(link.source,id);
          if (descriptor && value !== undefined) applyRecordProps(entry.stored,writeCanonicalParameter(descriptor,entry.host,value,entry.ppi));
        }
        if (link.linkedContent) {
          const source=this.sourceRecord(link.source);
          if (source?.image) {
            const saved=entry.stored,image=source.image;this.pending=this.pending.then(async()=>{saved.content=await image.encode();});
          } else if (source?.content) entry.stored.content=source.content;
          else if (source?.raster) {
            const saved=entry.stored, raster=source.raster;
            this.pending=this.pending.then(async()=>{saved.content=await new RasterSurface(raster.intrinsicPpi,raster).encode();});
          }
        }
        delete entry.stored.referenceOnly;
        entry.host=hostFromRecord(entry.stored);
      }
    } finally {this.resolvingDeleted=false;}
    const recovery={link:before,signature:this.signature(entry)};
    this.apply(entry,{parameterLink:null});
    if (entry.liveLayer) entry.liveLayer.linkRecovery=recovery;
    else if (entry.stored) entry.stored.common.linkRecovery=recovery;
    this.saveChangedDocument(entry);
  }

  private saveChangedDocument(entry: RecordEntry): void {
    if (entry.live) {this.engine.scheduleSave(); return;}
    if (entry.address.document.kind === 'page') this.enqueueSaves(new Set([entry.address.document.id]));
    else {
      const item=this.engine.bins.items.find(item=>item.id===entry.address.document.id);
      if (item) this.pending=this.pending.then(()=>saveBin(item));
    }
  }

  private reconcileDeletion(): void {
    const entries=this.records(), owners=new Map<string,RecordEntry>();
    for (const entry of entries) {
      const children=entry.liveLayer?.type === 'canvas' ? entry.liveLayer.childIds : entry.stored?.scope?.children.map(child=>child.id) ?? [];
      for (const id of children) owners.set(addrKey({document:entry.address.document,layerId:id}),entry);
    }
    for (const entry of entries) {
      const recovery=entry.host.linkRecovery, link=entry.host.parameterLink ?? recovery?.link; if (!link) continue;
      const source=this.find(link.source);
      if (recovery && source) {
        this.apply(entry,{parameterLink:this.signature(entry) === recovery.signature ? recovery.link : null});
        if (entry.liveLayer) entry.liveLayer.linkRecovery=undefined;
        else if (entry.stored) entry.stored.common.linkRecovery=undefined;
        this.saveChangedDocument(entry);
      } else if (!recovery && !source && this.deleted.has(addrKey(link.source))) {
        const canvas=owners.get(addrKey(entry.address));
        const inherited = canvas?.host.type === 'canvas' && Object.values(canvas.host.parameterLink?.structure?.inherited ?? {}).includes(entry.host.id);
        if (entry.host.type !== 'canvas' && !inherited) this.freezeEntry(entry);
      }
    }
  }

  authoredContent(layer: Layer): void {
    layer.linkRecovery=undefined;
  }


  private effectiveName(address: LayerAddress, visited = new Set<string>()): string | undefined {
    const key = addrKey(address);
    if (visited.has(key)) throw new Error('循環参照です');
    visited.add(key);
    const entry = this.find(address) ?? this.archivedEntry(address), link = entry?.host.parameterLink;
    return link?.linkedName ? this.effectiveName(link.source, visited) ?? entry?.host.name : entry?.host.name;
  }

  private canonicalState(host: ParameterHost, _ppi: number): unknown {
    return structuredClone(host.state);
  }

  private resolveState(host: ParameterHost, ppi: number, sourceState: unknown): unknown {
    const link = host.parameterLink!;
    const result: ParameterHost = {...host, state: structuredClone(sourceState)};
    const preview = this.previewFields.get(addrKey(this.currentAddress(host.id)));
    const catalogHost={...host,state:sourceState};
    for (const [id, descriptor] of linkableParameterMap(catalogHost)) {
      if (parameterById(catalogHost, id)?.scope !== 'state' || (link.linkedParameterIds.includes(id) && !preview?.has(id))) continue;
      const value = readCanonicalParameter(descriptor, host, ppi);
      const patch = writeCanonicalParameter(descriptor, result, value, 25.4) as LayerProps;
      if (patch.state !== undefined) result.state = layerDefinition(host.type).state.applyPatch(result.state as never, patch.state as never);
    }
    if (host.state && typeof host.state === 'object' && 'maskLayerIds' in host.state) {
      (result.state as {maskLayerIds: unknown}).maskLayerIds = structuredClone((host.state as {maskLayerIds: unknown}).maskLayerIds);
    }
    return applyStateOverrides(result.state, link.stateOverrides ?? {});
  }

  private effectiveState(entry: RecordEntry, visited = new Set<string>()): unknown {
    const key = addrKey(entry.address);
    if (visited.has(key)) throw new Error('循環参照です');
    visited.add(key);
    const link = entry.host.parameterLink, source = link?.linkedState ? this.find(link.source) ?? this.archivedEntry(link.source) : undefined;
    return source?.host.type === entry.host.type
      ? this.resolveState(entry.host, entry.ppi, this.effectiveState(source, visited))
      : this.canonicalState(entry.host, entry.ppi);
  }
  private readonly decodedImages = new WeakMap<Blob, import('../layers').ImageLayer['runtime']>();
  private readonly decodingImages = new WeakSet<Blob>();
  private prepareImageContent(blob: Blob): void {
    if (this.decodedImages.has(blob) || this.decodingImages.has(blob)) return;
    this.decodingImages.add(blob);
    const ready = layerDefinition('image').codec.decodeRuntime!(blob, {artboard: this.engine.artboard}).then(runtime => {
      if (runtime) this.decodedImages.set(blob, runtime);
      this.engine.requestRender();
    });
    this.pending = Promise.all([this.pending, ready]).then(() => undefined);
  }

  private imageContent(address: LayerAddress, visited = new Set<string>()): import('../layers').ImageLayer['runtime'] | null {
    const key = addrKey(address);
    if (visited.has(key)) throw new Error('循環参照です');
    visited.add(key);
    const entry = this.find(address);
    if (entry?.host.type !== 'image') return null;
    const link = entry.host.parameterLink;
    if (link?.linkedContent) {
      const upstream = this.imageContent(link.source, visited); if (upstream) return upstream;
    }
    if (entry.liveLayer?.type === 'image') return entry.liveLayer.runtime;
    const archived = entry.stored as import('../layer-types/definition').LayerSnapshot | undefined;
    if (archived?.image) return {asset:archived.image};
    const blob = entry.stored?.content;
    if (blob) {this.prepareImageContent(blob); return this.decodedImages.get(blob) ?? null;}
    return null;
  }

  private readonly decodedContents = new WeakMap<Blob, RasterSurface>();
  private readonly decodingContents = new WeakSet<Blob>();

  private prepareRasterContent(blob: Blob): void {
    if (this.decodedContents.has(blob) || this.decodingContents.has(blob)) return;
    this.decodingContents.add(blob);
    const ready = RasterSurface.decode(blob).then(surface => {
      this.decodedContents.set(blob, surface);
      this.engine.requestRender();
    });
    this.pending = Promise.all([this.pending, ready]).then(() => undefined);
  }

  private rasterContent(address: LayerAddress, visited = new Set<string>()): SparseRasterSnapshot | null {
    const key = addrKey(address);
    if (visited.has(key)) throw new Error('循環参照です');
    visited.add(key);
    const entry = this.find(address);
    if (entry?.host.type !== 'raster') return null;
    const live = entry.liveLayer?.type === 'raster' ? entry.liveLayer : null;
    const link = entry.host.parameterLink;
    if (link?.linkedContent && !live?.runtime.surface.contentDetached) {
      const upstream = this.rasterContent(link.source, visited);
      if (upstream) return upstream;
    }
    if (live) return live.runtime.surface.snapshot();
    const archived = entry.stored as import('../layer-types/definition').LayerSnapshot | undefined;
    if (archived?.raster) return archived.raster;
    const blob = entry.stored?.content;
    return blob ? this.decodedContents.get(blob)?.snapshot() ?? null : null;
  }

  detachRasterContent(layer: import('../layers').RasterLayer, before: SparseRasterSnapshot): import('../history/historyTree').LayerContentOp | null {
    this.authoredContent(layer);
    if (!layer.parameterLink?.linkedContent || !layer.runtime.surface.contentDetached) return null;
    const beforeSnapshot = this.engine.layerService.snapshotLayer(layer, false);
    beforeSnapshot.raster = before;
    layer.parameterLink.linkedContent = false;
    layer.runtime.surface.unbind();
    const after = this.engine.layerService.snapshotLayer(layer, true);
    return {kind: 'layerContent', layerId: layer.id, before: beforeSnapshot, after};
  }
  private pending: Promise<void> = Promise.resolve();
  private entriesByKey = new Map<string, RecordEntry>();
  private targetsBySource = new Map<string, string[]>();
  private readonly previewFields=new Map<string,Set<string>>();

  constructor(private engine: PaintEngine) {}

  async refreshCatalog(): Promise<void> {
    const loaded = await Promise.all(this.engine.pages.pageOrder.map(id => loadPage(id)));
    this.pages = new Map(loaded.filter((page): page is SavedPage => !!page).map(page => [page.id, page]));
    this.rebuildIndex();
    await this.flush();
  }

  noteSavedPage(page: SavedPage): void {
    this.pages.set(page.id, structuredClone(page));
    this.rebuildIndex();
  }

  archivePage(pageId: string): void {
    const page=this.pages.get(pageId);
    if (page) this.archiveRemoval(page.layers.map(layer=>layer.id),{kind:'page',id:pageId});
  }

  removePage(pageId: string): void {
    this.pages.delete(pageId);
    this.rebuildIndex();
  }

  flush(): Promise<void> { return this.pending; }

  private currentAddress(layerId: string): LayerAddress {
    return { document: this.engine.documentKey, layerId };
  }

  private rebuildIndex(): void {
    this.entriesByKey.clear();
    this.virtualEntries.clear();
    this.targetsBySource.clear();
    for (const entry of this.collectRecords()) {
      const key = addrKey(entry.address);
      this.entriesByKey.set(key, entry);
      if (entry.stored?.type === 'raster' && entry.stored.content) this.prepareRasterContent(entry.stored.content);
      if (entry.stored?.type === 'image' && entry.stored.content) this.prepareImageContent(entry.stored.content);
      const source = entry.host.parameterLink?.source;
      if (!source) continue;
      const list = this.targetsBySource.get(addrKey(source)) ?? [];
      list.push(key);
      this.targetsBySource.set(addrKey(source), list);
    }
    for (const entry of this.entriesByKey.values()) if (entry.stored?.referenceOnly) entry.host.state=this.effectiveState(entry);
  }

  private collectRecords(): RecordEntry[] {
    const result: RecordEntry[] = [];
    const documents = [
      ...this.engine.pages.pageOrder.map(id => ({key: {kind: 'page' as const, id}, saved: this.pages.get(id)})),
      ...this.engine.bins.items.map(bin => ({key: {kind: 'bin-item' as const, id: bin.id}, saved: {...bin, pageSpec: bin.workArea}})),
    ];
    const active = this.engine.documentKey;
    for (const {key, saved} of documents) {
      if (key.kind === active.kind && key.id === active.id) {
        for (const layer of this.engine.layerService.layers) result.push({address: {document: key, layerId: layer.id},
          host: layer, ppi: this.engine.getPageSpec().ppi, live: true, liveLayer: layer});
      } else if (saved) {
        for (const layer of saved.layers) result.push({address: {document: key, layerId: layer.id},
          host: hostFromRecord(layer), ppi: saved.pageSpec.ppi, live: false, stored: layer});
      }
    }
    return result;
  }

  private records(): RecordEntry[] {
    this.rebuildIndex();
    return [...this.entriesByKey.values()];
  }

  private archivedEntry(address: LayerAddress): RecordEntry | undefined {
    const record=this.deleted.get(addrKey(address));
    return record ? {address,host:hostFromRecord(record.layer),ppi:25.4,live:false,stored:record.layer} : undefined;
  }

  private authoredEntry(entry: RecordEntry, visited=new Set<string>()): boolean {
    if (entry.stored?.referenceOnly) return false;
    const key=addrKey(entry.address); if (visited.has(key)) return false; visited.add(key);
    const link=entry.host.parameterLink;
    if (!link || !link.linkedState || !link.linkedName || Object.keys(link.stateOverrides ?? {}).length) return true;
    if ((entry.host.type === 'raster' || entry.host.type === 'image') && !link.linkedContent) return true;
    if ([...linkableParameterMap(entry.host).keys()].some(id=>!link.linkedParameterIds.includes(id))) return true;
    if (entry.host.type === 'canvas') {
      const overlay=link.structure;
      if (!overlay || overlay.placements.length || overlay.suppressed.length) return true;
      const inherited=new Set(Object.values(overlay.inherited));
      for (const child of entry.stored?.scope?.children ?? []) {
        if (!inherited.has(child.id)) return true;
        const nested=this.find({document:entry.address.document,layerId:child.id});
        if (nested && this.authoredEntry(nested,visited)) return true;
      }
    }
    return false;
  }

  private find(address: LayerAddress): RecordEntry | undefined {
    if (!this.entriesByKey.size) this.rebuildIndex();
    const key=addrKey(address);
    let entry=this.entriesByKey.get(key) ?? this.virtualEntries.get(key);
    if (!entry) {
      // A variant may be unopened when an upstream canvas adds a child. Resolve its virtual
      // occurrences on demand; no duplicate authored child is required in that document.
      for (const candidate of this.entriesByKey.values()) {
        if (candidate.stored?.type !== 'canvas' || this.resolvingScopes.has(addrKey(candidate.address))) continue;
        this.resolveStoredScope(candidate);
        entry=this.virtualEntries.get(key); if (entry) break;
      }
    }
    if (entry || !this.resolvingDeleted) return entry;
    return this.archivedEntry(address);
  }

  private resolveStoredScope(entry: RecordEntry): import('../../model/document/types').Scope | undefined {
    const record=entry.stored, link=entry.host.parameterLink, overlay=link?.structure;
    if (record?.type !== 'canvas' || !link || !overlay) return record?.scope;
    const key=addrKey(entry.address);
    if (this.resolvingScopes.has(key)) return record.scope;
    this.resolvingScopes.add(key);
    try {
      const source=this.sourceRecord(link.source); if (source?.type !== 'canvas') return record.scope;
      const mapping={...overlay.inherited};
      for (const child of source.scope?.children ?? []) mapping[child.id] ??= inheritedOccurrenceId(record.id,child.id);
      const inherited=new Set(Object.values(mapping));
      const desired: string[]=[];
      for (const child of source.scope?.children ?? []) {
        if (overlay.suppressed.includes(child.id)) continue;
        const id=mapping[child.id], address={document:entry.address.document,layerId:id};
        const existing=this.entriesByKey.get(addrKey(address));
        if (!existing) {
          const upstream={document:link.source.document,layerId:child.id};
          const original=this.sourceRecord(upstream); if (!original) continue;
          const host=hostFromRecord(original);
          const parameterLink:LayerParameterLink={source:upstream,sourceNameHint:host.name,sourcePageIndexHint:0,
            linkedName:true,linkedState:true,linkedContent:original.type === 'raster' || original.type === 'image',
            linkedParameterIds:[...linkableParameterMap(host).keys()],fallbackValues:{},stateOverrides:{},
            ...(original.type === 'canvas' ? {structure:{inherited:{},suppressed:[],placements:[]}} : {})};
          const stored:SavedLayer={id,type:original.type,unit:'mm',referenceOnly:true,common:{...original.common,parameterLink},state:{},
            ...(original.type === 'canvas' ? {scope:{id,children:[]}} : {})};
          this.virtualEntries.set(addrKey(address),{address,host:{...hostFromRecord(stored),state:original.state},ppi:entry.ppi,live:false,stored});
        }
        desired.push(id);
      }
      const sourceIds=new Set(source.scope?.children.map(child=>child.id));
      for (const [sourceId,id] of Object.entries(overlay.inherited)) {
        if (sourceIds.has(sourceId) || overlay.suppressed.includes(sourceId)) continue;
        const child=this.entriesByKey.get(addrKey({document:entry.address.document,layerId:id}));
        if (child && this.authoredEntry(child)) desired.push(id);
      }
      for (const child of record.scope?.children ?? []) if (!inherited.has(child.id)) desired.push(child.id);
      for (const placement of overlay.placements) {
        const index=desired.indexOf(placement.id); if (index < 0) continue;
        desired.splice(index,1); desired.splice(Math.min(placement.index,desired.length),0,placement.id);
      }
      return {id:record.id,children:desired.map(id=>({id,entityId:id}))};
    } finally {this.resolvingScopes.delete(key);}
  }

  private apply(entry: RecordEntry, props: LayerProps): void {
    if (entry.live && entry.liveLayer) this.engine.layerService.assignProps(entry.liveLayer, props);
    else if (entry.stored) {
      applyRecordProps(entry.stored, props);
      entry.host = hostFromRecord(entry.stored);
    }
    this.rebuildIndex();
  }

  private enqueueSaves(pageIds: Set<string>): void {
    if (!pageIds.size) return;
    const pages = [...pageIds].map(id => this.pages.get(id)).filter((page): page is SavedPage => !!page);
    this.pending = this.pending.then(async () => {
      for (const page of pages) await savePage(page);
    }).catch(() => {
      useStore.getState().set({ toolNotice: '別ページのリンク更新を保存できませんでした。ページ表示時に再同期します。' });
    });
  }

  private common(source: RecordEntry, target: RecordEntry): string[] {
    const sourceMap = linkableParameterMap(source.host);
    const targetMap = linkableParameterMap(target.host);
    return [...sourceMap.keys()].filter(id => {
      const value = this.effectiveValue(source, id);
      return targetMap.has(id) && (value !== null || targetMap.get(id)!.nullable === true);
    });
  }

  private wouldCycle(target: LayerAddress, source: LayerAddress): boolean {
    if (target.document.kind === 'bin-item' && source.document.kind === 'page') return true;
    const visited=new Set<string>(),visiting=new Set<string>();
    const visit=(address:LayerAddress):boolean=>{
      if(sameAddress(address,target)) return true;
      const key=addrKey(address);
      if(visiting.has(key)) return true;
      if(visited.has(key)) return false;
      visiting.add(key);
      const entry=this.find(address);
      const upstream=entry?.host.parameterLink?.source;
      if(upstream && visit(upstream)) return true;
      if(entry?.host.type==='canvas') {
        for(const childId of entry.liveLayer?.type === 'canvas' ? entry.liveLayer.childIds : entry.stored?.scope?.children.map(child => child.id) ?? []) if(visit({document:address.document,layerId:childId})) return true;
      }
      visiting.delete(key);visited.add(key);return false;
    };
    return visit(source);
  }

  private makeLink(
    target: RecordEntry,
    sourceAddress: LayerAddress,
    onlyEqual: boolean,
    hint?: { name: string; pageIndex: number },
  ): LayerParameterLink {
    const source = this.find(sourceAddress);
    const sourcePageIndex = Math.max(0, this.engine.pages.pageOrder.indexOf(sourceAddress.document.id));
    const link: LayerParameterLink = {
      source: { ...sourceAddress },
      linkedName: true,
      ...(source?.host.type === 'canvas' && target.liveLayer?.type === 'canvas' ? {structure: this.engine.canvases?.initialize(target.liveLayer, sourceAddress) ?? {inherited: {}, suppressed: [], placements: []}} : {}),
      ...(source?.host.type === target.host.type ? {linkedState: true, stateOverrides: {}} : {}),
      ...(source?.host.type === target.host.type && (target.host.type === 'raster' || target.host.type === 'image') ? {linkedContent: true} : {}),
      sourceNameHint: source?.host.name ?? hint?.name ?? '削除済みレイヤー',
      sourcePageIndexHint: source ? sourcePageIndex : hint?.pageIndex ?? sourcePageIndex,
      linkedParameterIds: [],
      fallbackValues: {},
    };
    const sourceMap = source ? linkableParameterMap(source.host) : new Map();
    const targetMap = linkableParameterMap(target.host);
    const ids = source ? this.common(source, target) : [...targetMap.keys()];
    for (const id of ids) {
      const sourceValue = source && sourceMap.get(id)
        ? this.effectiveValue(source, id)
        : readCanonicalParameter(targetMap.get(id)!, target.host, target.ppi);
      const targetValue = readCanonicalParameter(targetMap.get(id)!, target.host, target.ppi);
      if (sourceValue === null && targetMap.get(id)!.nullable !== true) continue;
      if (onlyEqual && !parameterValuesEqual(sourceValue, targetValue)) continue;
      link.linkedParameterIds.push(id);
      link.fallbackValues[id] = sourceValue as SemanticParameterValue;
    }
    return link;
  }

  createPasteLink(targetLayerId: string, source: LayerAddress, hint?: { name: string; pageIndex: number }): void {
    this.rebuildIndex();
    const target = this.find(this.currentAddress(targetLayerId));
    if (!target || this.wouldCycle(target.address,source)) return;
    const link = this.makeLink(target, source, false, hint);
    this.apply(target, { parameterLink: link });
    this.propagateFrom(source);
  }

  sourceRecord(address: LayerAddress): import('../layer-types/definition').LayerSnapshot | undefined {
    const entry = this.find(address);
    if (!entry) return undefined;
    if (entry.stored) {
      const record={...entry.stored,common:{...entry.stored.common},state:this.effectiveState(entry)};
      if (record.type === 'canvas') record.scope=this.resolveStoredScope(entry);
      record.common.name=this.effectiveName(address) ?? record.common.name;
      for (const [id,descriptor] of linkableParameterMap(entry.host)) {
        if (!entry.host.parameterLink?.linkedParameterIds.includes(id)) continue;
        const value=this.canonicalValue(address,id);
        if (value !== undefined) applyRecordProps(record,writeCanonicalParameter(descriptor,hostFromRecord(record),value,entry.ppi));
      }
      if (entry.host.parameterLink?.linkedContent) {
        const source=this.sourceRecord(entry.host.parameterLink.source) ?? this.deleted.get(addrKey(entry.host.parameterLink.source))?.layer;
        if (source) return {...record,content:source.content,raster:source.raster,image:source.image};
      }
      return record;
    }
    const layer = entry.liveLayer;
    if (!layer) return undefined;
    this.resolveLayer(layer);
    return {id: layer.id, type: layer.type, unit: 'mm', common: commonRecordFrom(layer), state: this.canonicalState(layer, entry.ppi),
      ...(layer.type === 'canvas' ? {scope: {id: layer.id, children: layer.childIds.map(id => ({id, entityId: id}))}} : {}),
      ...(layer.type === 'raster' ? {raster: layer.runtime.surface.snapshot()} : {}),
      ...(layer.type === 'image' ? {image: layer.runtime.asset} : {})};
  }

  captureLocalRestoreOps(layer: Layer): import('../history/historyTree').AtomicOp[] {
    this.resolveLayer(layer);
    const props = {name: layer.name, opacity: layer.opacity, blend: layer.blend, visible: layer.visible, ...layerTypeProps(layer)};
    const ops: import('../history/historyTree').AtomicOp[] = [{kind: 'layerProps', layerId: layer.id, before: props, after: props}];
    if (layer.type === 'raster' || layer.type === 'image') {
      const snapshot = this.engine.layerService.snapshotLayer(layer, true);
      ops.push({kind: 'layerContent', layerId: layer.id, before: snapshot, after: snapshot});
    }
    return ops;
  }

  async changeSource(targetLayerId: string, source: LayerAddress): Promise<void> {
    await this.flush();
    this.rebuildIndex();
    const targetAddress = this.currentAddress(targetLayerId);
    const target = this.find(targetAddress);
    if (!target || this.wouldCycle(targetAddress, source)) return;
    const local = target.liveLayer ? this.captureLocalRestoreOps(target.liveLayer) : [];
    const before = cloneLink(target.host.parameterLink);
    const after = this.makeLink(target, source, true);
    this.apply(target, { parameterLink: after });
    this.engine.history.push({kind: 'batch', ops: [...local, {kind: 'layerLink', target: targetAddress, before, after: cloneLink(after)}]}, 'リンク元を変更');
    this.propagateFrom(source);
    this.engine.committed();
  }

  removeLink(targetLayerId: string): void {
    const targetAddress = this.currentAddress(targetLayerId);
    const target = this.find(targetAddress);
    if (!target?.host.parameterLink) return;
    if(target.liveLayer) this.resolveLayer(target.liveLayer);
    const local = target.liveLayer ? this.captureLocalRestoreOps(target.liveLayer) : [];
    const before = cloneLink(target.host.parameterLink);
    this.apply(target, { parameterLink: null });
    this.engine.history.push({kind: 'batch', ops: [{kind: 'layerLink', target: targetAddress, before, after: null}, ...local]}, 'リンクを解除');
    this.engine.committed();
  }

  unlinkParameter(targetLayerId: string, semanticId: string): void {
    this.unlinkParameters([targetLayerId], semanticId);
  }

  unlinkParameters(targetLayerIds: string[], semanticId: string): void {
    const ops = targetLayerIds.flatMap(targetLayerId => {
      const targetAddress = this.currentAddress(targetLayerId);
      const target = this.find(targetAddress);
      const current = target?.host.parameterLink;
      if (!target || !current?.linkedParameterIds.includes(semanticId)) return [];
      if(target.liveLayer) this.resolveLayer(target.liveLayer);
      const before = cloneLink(current)!;
      const after = cloneLink(current)!;
      after.linkedParameterIds = after.linkedParameterIds.filter(id => id !== semanticId);
      this.apply(target, { parameterLink: after });
      return [{ kind: 'layerLink' as const, target: targetAddress, before, after: cloneLink(after) }];
    });
    if (!ops.length) return;
    this.engine.history.push(ops.length === 1 ? ops[0] : { kind: 'batch', ops }, 'パラメータのリンクを解除');
    this.engine.committed();
  }

  isRasterContentShared(layerId: string): boolean {
    const address = this.currentAddress(layerId);
    return this.records().some(entry => entry.host.type === 'raster' && entry.host.parameterLink?.linkedContent
      && sameAddress(entry.host.parameterLink.source, address));
  }

  async relinkContent(layerId: string): Promise<void> {
    if (this.engine.isBusy()) return;
    this.rebuildIndex(); await this.flush();
    const layer = this.engine.layerService.byId(layerId);
    const link = layer?.parameterLink;
    if (!layer || (layer.type !== 'raster' && layer.type !== 'image') || !link || link.linkedContent || this.find(link.source)?.host.type !== layer.type) return;
    const before = this.engine.layerService.snapshotLayer(layer, true);
    if (layer.type === 'raster') layer.runtime.surface.unbind();
    link.linkedContent = true;
    this.resolveLayer(layer);
    const after = this.engine.layerService.snapshotLayer(layer, true);
    this.engine.history.push({kind: 'layerContent', layerId, before, after}, '描画内容を再リンク');
    this.engine.layerService.bumpLayer(layerId); this.engine.committed();
  }

  async relink(targetLayerId: string, semanticId?: string): Promise<void> {
    await this.flush();
    this.rebuildIndex();
    const targetAddress = this.currentAddress(targetLayerId);
    const target = this.find(targetAddress);
    const current = target?.host.parameterLink;
    const source = current ? this.find(current.source) : undefined;
    if (!target || !current || !source) return;
    const before = cloneLink(current);
    const beforeProps = target.live && target.liveLayer ? {
      opacity: target.liveLayer.opacity,
      visible: target.liveLayer.visible,
      blend: target.liveLayer.blend,
      ...layerTypeProps(target.liveLayer),
    } : {};
    const next = cloneLink(current)!;
    const ids = semanticId ? [semanticId] : this.common(source, target);
    const sourceMap = linkableParameterMap(source.host);
    const targetMap = linkableParameterMap(target.host);
    for (const id of ids) {
      const sourceDescriptor = sourceMap.get(id), targetDescriptor = targetMap.get(id);
      if (!sourceDescriptor || !targetDescriptor) continue;
      const value = this.effectiveValue(source, id);
      if (value === null && targetDescriptor.nullable !== true) continue;
      this.apply(target, writeCanonicalParameter(targetDescriptor, target.host, value, target.ppi));
      if (!next.linkedParameterIds.includes(id)) next.linkedParameterIds.push(id);
      next.fallbackValues[id] = value as SemanticParameterValue;
    }
    this.apply(target, { parameterLink: next });
    const afterProps = target.live && target.liveLayer ? {
      opacity: target.liveLayer.opacity,
      visible: target.liveLayer.visible,
      blend: target.liveLayer.blend,
      ...layerTypeProps(target.liveLayer),
    } : {};
    this.engine.history.push({ kind: 'batch', ops: [
      { kind: 'layerProps', layerId: targetLayerId, before: beforeProps, after: afterProps },
      { kind: 'layerLink', target: targetAddress, before, after: cloneLink(next) },
    ] }, semanticId ? 'パラメータを再リンク' : 'すべて再リンク');
    this.propagateFrom(targetAddress);
    this.engine.committed();
  }

  detachChanged(layer: Layer, before: ParameterHost, after: ParameterHost, preserveIfSourceMatches = false): { before: LayerParameterLink; after: LayerParameterLink } | null {
    if (!layer.parameterLink) return null;
    const ppi = this.engine.getPageSpec().ppi;
    const beforeMap = linkableParameterMap(before), afterMap = linkableParameterMap(after);
    const old = cloneLink(layer.parameterLink)!;
    const next = cloneLink(layer.parameterLink)!;
    if (before.name !== after.name) next.linkedName = false;
    if (next.linkedState) {
      const beforeState = this.canonicalState(before, ppi), afterState = this.canonicalState(after, ppi);
      const changes = stateChanges(beforeState, afterState);
      const covered = new Set<string>();
      for (const [id, descriptor] of beforeMap) {
        const updated = afterMap.get(id);
        if (parameterById(before, id)?.scope !== 'state' || !updated) continue;
        const value = readCanonicalParameter(updated, after, ppi);
        if (parameterValuesEqual(readCanonicalParameter(descriptor, before, ppi), value)) continue;
        const patch = writeCanonicalParameter(descriptor, before, value, ppi) as LayerProps;
        if (patch.state === undefined) continue;
        const state = layerDefinition(before.type).state.applyPatch(before.state as never, patch.state as never);
        for (const path of Object.keys(stateChanges(beforeState, this.canonicalState({...before, state}, ppi)))) covered.add(path);
      }
      next.stateOverrides = {...next.stateOverrides, ...Object.fromEntries(Object.entries(changes).filter(([path]) => !covered.has(path)))};
    }
    next.linkedParameterIds = next.linkedParameterIds.filter(id => {
      const a = beforeMap.get(id), b = afterMap.get(id);
      if (!a || !b) { delete next.fallbackValues[id]; return false; }
      const afterValue = readCanonicalParameter(b, after, ppi);
      let changed = !parameterValuesEqual(readCanonicalParameter(a, before, ppi), afterValue);
      if (changed && preserveIfSourceMatches) {
        const source = this.find(old.source);
        const sourceDescriptor = source && linkableParameterMap(source.host).get(id);
        if (source && sourceDescriptor) changed = !parameterValuesEqual(
          this.effectiveValue(source, id),
          afterValue,
        );
      }
      if (changed) delete next.fallbackValues[id];
      return !changed;
    });
    return JSON.stringify(old) === JSON.stringify(next) ? null : { before: old, after: next };
  }

  private effectiveValue(entry: RecordEntry, id: string): SemanticParameterValue {
    const value = this.canonicalValue(entry.address, id);
    if (value !== undefined) return value;
    const descriptor = linkableParameterMap(entry.host).get(id);
    if (!descriptor) throw new Error(`Unknown linked field: ${id}`);
    return readCanonicalParameter(descriptor, entry.host, entry.ppi);
  }

  private canonicalValue(address:LayerAddress,id:string,visited=new Set<string>()):SemanticParameterValue|undefined {
    const key=addrKey(address);
    if(visited.has(key)) throw new Error('循環参照です');
    visited.add(key);
    const entry=this.find(address) ?? this.archivedEntry(address);
    if(!entry) return undefined;
    const link=entry.host.parameterLink;
    if(link?.linkedParameterIds.includes(id) && !this.previewFields.get(key)?.has(id)) {
      const value=this.canonicalValue(link.source,id,visited);
      return value===undefined ? link.fallbackValues[id] : value;
    }
    const descriptor=linkableParameterMap(entry.host).get(id);
    return descriptor?readCanonicalParameter(descriptor,entry.host,entry.ppi):undefined;
  }

  /** The mutable Layer object is a view cache for existing tools, not another link source copy. */
  resolveLayer<L extends Layer>(layer:L):L {
    const link=layer.parameterLink;
    if (layer.type === 'raster') {
      if (link?.linkedContent) layer.runtime.surface.bind(addrKey(link.source), () => this.rasterContent(link.source));
      else layer.runtime.surface.unbind();
    }
    if (layer.type === 'image' && link?.linkedContent) {
      const runtime = this.imageContent(link.source); if (runtime) layer.runtime = runtime;
    }
    if(!link) return layer;
    if (link.linkedName) layer.name = this.effectiveName(link.source) ?? layer.name;
    const address=this.currentAddress(layer.id),key=addrKey(address);
    if (link.linkedState && !this.previewFields.has(key)) {
      const source = this.find(link.source);
      if (source?.host.type === layer.type) {
        const state = this.resolveState(layer, this.engine.getPageSpec().ppi, this.effectiveState(source));
        layer.state = state as Layer['state'];
      }
    }
    for(const id of link.linkedParameterIds) {
      if(this.previewFields.get(key)?.has(id)) continue;
      const descriptor=linkableParameterMap(layer).get(id);
      if(!descriptor) continue;
      const value=this.canonicalValue(link.source,id);
      if(value===undefined || (value===null && !descriptor.nullable)) continue;
      if(!parameterValuesEqual(readCanonicalParameter(descriptor,layer,this.engine.getPageSpec().ppi),value)) {
        applyLayerProps(layer,writeCanonicalParameter(descriptor,layer,value,this.engine.getPageSpec().ppi));
      }
    }
    return layer;
  }

  propagateFrom(sourceAddress: LayerAddress, preview = false): import('../history/historyTree').LayerLinkOp[] {
    this.rebuildIndex();
    const source=this.find(sourceAddress),key=addrKey(sourceAddress);
    if(preview && source?.host.parameterLink) {
      const fields=new Set<string>();
      const descriptors=linkableParameterMap(source.host);
      for(const id of source.host.parameterLink.linkedParameterIds) {
        const descriptor=descriptors.get(id);
        if(descriptor && !parameterValuesEqual(readCanonicalParameter(descriptor,source.host,source.ppi),this.canonicalValue(source.host.parameterLink.source,id)??null)) fields.add(id);
      }
      this.previewFields.set(key,fields);
    } else this.previewFields.delete(key);
    const queue=[key],seen=new Set<string>(queue);
    while(queue.length) {
      for(const targetKey of this.targetsBySource.get(queue.shift()!)??[]) {
        if(seen.has(targetKey)) continue;
        seen.add(targetKey);queue.push(targetKey);
        const target=this.entriesByKey.get(targetKey);
        if(target?.live) this.engine.layerService.bumpLayer(target.address.layerId);
      }
    }
    return [];
  }

  reconcileAll(): void {
    this.previewFields.clear();this.rebuildIndex();
    this.reconcileDeletion();
    for(const entry of this.records()) if(entry.liveLayer) this.resolveLayer(entry.liveLayer);
  }

  applyHistoryLink(targetAddress: LayerAddress, link: LayerParameterLink | null): void {
    const target = this.find(targetAddress);
    if (!target) return;
    if (target.liveLayer?.type === 'raster') target.liveLayer.runtime.surface.unbind();
    this.apply(target, { parameterLink: link });
    if (!target.live && targetAddress.document.kind === 'page') this.enqueueSaves(new Set([targetAddress.document.id]));
    else if (!target.live) {
      const bin = this.engine.bins.items.find(item => item.id === targetAddress.document.id);
      if (bin) this.pending = this.pending.then(() => saveBin(bin));
    }
  }

  candidates(targetLayerId: string): LayerLinkCandidate[] {
    this.rebuildIndex();
    const targetAddress = this.currentAddress(targetLayerId);
    const target = this.find(targetAddress);
    if (!target) return [];
    return this.records().filter(source => targetAddress.document.kind !== 'bin-item' || source.address.document.kind === 'bin-item').map(source => {
      const compatible = this.common(source, target);
      const targetMap = linkableParameterMap(target.host);
      const equalCount = compatible.filter(id => parameterValuesEqual(
        this.effectiveValue(source, id),
        readCanonicalParameter(targetMap.get(id)!, target.host, target.ppi),
      )).length;
      return {
        address: source.address,
        name: source.host.name,
        pageIndex: this.engine.pages.pageOrder.indexOf(source.address.document.id),
        type: source.host.type,
        compatibleCount: compatible.length,
        equalCount,
        disabledReason: sameAddress(source.address, targetAddress) ? '自分自身です'
          : this.wouldCycle(targetAddress, source.address) ? '循環参照になります' : undefined,
      };
    });
  }

  infoFor(layerId: string): {
    source?: LayerLinkEndpointSummary;
    targets: LayerLinkEndpointSummary[];
    compatibleIds: string[];
  } {
    this.rebuildIndex();
    const address = this.currentAddress(layerId);
    const target = this.find(address);
    const link = target?.host.parameterLink;
    const sourceEntry = link ? this.find(link.source) : undefined;
    const source = link ? {
      address: { ...link.source },
      name: sourceEntry?.host.name ?? link.sourceNameHint,
      pageIndex: sourceEntry ? this.engine.pages.pageOrder.indexOf(sourceEntry.address.document.id) : link.sourcePageIndexHint,
      linkedCount: link.linkedParameterIds.length,
      missing: !sourceEntry,
    } : undefined;
    const targetKeys = this.targetsBySource.get(addrKey(address)) ?? [];
    const targets = targetKeys.flatMap(key => {
      const entry = this.entriesByKey.get(key);
      return entry?.host.parameterLink ? [{
        address: { ...entry.address },
        name: entry.host.name,
        pageIndex: this.engine.pages.pageOrder.indexOf(entry.address.document.id),
        linkedCount: entry.host.parameterLink.linkedParameterIds.length,
      }] : [];
    });
    return { source, targets, compatibleIds: sourceEntry && target ? this.common(sourceEntry, target) : [] };
  }
}
