import type {
  LayerAddress,
  LayerLinkEndpointSummary,
  LayerParameterLink,
} from '../../model';
import { isLayerType } from '../../model';
import {
  linkableParameterMap,
  parameterValuesEqual,
  readCanonicalParameter,
} from '../layerParameters';
import type { Layer } from '../layers';
import { applyLayerProps, findLayerModule, layerHandler, layerTypeProps } from '../layer-types/registry';
import type { LayerProps } from '../layer-types/definition';
import { parameterById, type ParameterHost } from '../parameters/host';
import type { SavedPage } from '../persistence/db';
import type { PaintEngine } from '../PaintEngine';
import { commonFromOwned, type DocumentStore } from '../document/DocumentStore';
import type { LayerOwned, PageOwned } from '../document/types';
import { resolveParameterValue, type HostLookup, type ResolvedValue } from '../references/resolver';

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
  owned?: LayerOwned;
}

function addrKey(address: LayerAddress): string {
  return `${address.pageId}:${address.layerId}`;
}

function sameAddress(a: LayerAddress, b: LayerAddress): boolean {
  return a.pageId === b.pageId && a.layerId === b.layerId;
}

function cloneLink(
  link: LayerParameterLink | undefined | null,
): LayerParameterLink | null {
  return link ? structuredClone(link) : null;
}

function hostFromOwned(owned: LayerOwned): ParameterHost {
  return {
    ...commonFromOwned(owned.common, owned.id),
    type: isLayerType(owned.type) ? owned.type : 'raster',
    state: owned.state,
  };
}

function pageOwnedFromSaved(page: SavedPage): PageOwned {
  return {
    id: page.id,
    spec: { ...page.pageSpec },
    rootLayerIds: [...page.rootLayerIds],
    activeLayerId: page.activeLayerId,
    layers: page.layers.map((layer) => {
      const mod = findLayerModule(layer.kindId || layer.type);
      const loaded = mod?.loadState(layer.state);
      return {
        id: layer.id,
        type: layer.type,
        kindId: layer.kindId || mod?.kindId || `rin.layer.${layer.type}`,
        revision: layer.revision || mod?.revision || 1,
        common: structuredClone(layer.common),
        state: loaded?.status === 'ok' ? loaded.value : layer.state,
        content: layer.content,
      };
    }),
    history: page.history,
    view: { ...page.view },
    thumbnailVersion: page.thumbnailVersion,
    thumbnail: page.thumbnail,
    status: 'ok',
    reasons: [],
  };
}

/** 参照解決。リンク先へ値はコピーしない。 */
export class ParameterLinkService {
  private entriesByKey = new Map<string, RecordEntry>();
  private targetsBySource = new Map<string, string[]>();
  private indexedContext = '';
  private generation = 0;
  private viewCache = new WeakMap<Layer, { generation: number; view: Layer }>();

  constructor(private engine: PaintEngine) {}

  private document(): DocumentStore {
    return this.engine.document;
  }

  catalogCheckpoint(): () => void {
    const pages = this.document().allPages().map((page) => structuredClone(page));
    const meta = structuredClone(this.document().meta);
    return () => {
      this.document().replaceAll(meta, pages);
      this.invalidate();
    };
  }

  replaceCatalog(pages: SavedPage[]): void {
    this.document().replaceAll(
      {
        pageOrder: [...this.engine.pages.pageOrder],
        activePageId: this.engine.pages.activePageId,
        fonts: this.document().meta.fonts,
      },
      pages.map(pageOwnedFromSaved),
    );
    this.invalidate();
  }

  async refreshCatalog(): Promise<void> {
    this.invalidate();
  }

  noteSavedPage(page: SavedPage): void {
    this.document().setPage(pageOwnedFromSaved(page));
    this.invalidate();
  }

  removePage(pageId: string): void {
    this.document().removePage(pageId);
    this.invalidate();
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }

  invalidate(): void {
    this.generation++;
    this.indexedContext = '';
    this.entriesByKey.clear();
    this.targetsBySource.clear();
  }

  private invalidateViews(): void {
    this.generation++;
  }

  private currentAddress(layerId: string): LayerAddress {
    return { pageId: this.engine.pages.activePageId, layerId };
  }

  private lookup(): HostLookup {
    return {
      get: (address) => {
        const entry = this.find(address);
        return entry
          ? { address: entry.address, host: entry.host, ppi: entry.ppi }
          : undefined;
      },
    };
  }

  private entryAt(address: LayerAddress): RecordEntry | undefined {
    return this.entriesByKey.get(addrKey(address));
  }

  effectiveValue(host: ParameterHost, semanticId: string, pageId = this.engine.pages.activePageId): ResolvedValue {
    const linked = !!host.parameterLink?.linkedParameterIds.includes(semanticId);
    if (!linked) {
      const parameter = parameterById(host, semanticId);
      return { status: 'owned', value: parameter ? parameter.read(host, host.state) : null };
    }
    this.rebuildIndex();
    const address = { pageId, layerId: host.id };
    const entry = this.entryAt(address);
    const from = entry
      ? { address: entry.address, host: entry.host, ppi: entry.ppi }
      : { address, host, ppi: this.engine.getPageSpec().ppi };
    return resolveParameterValue(this.lookup(), from, semanticId, from.ppi);
  }

  resolvedView(layer: Layer): Layer {
    const link = layer.parameterLink;
    if (!link?.linkedParameterIds.length) return layer;
    const cached = this.viewCache.get(layer);
    if (cached && cached.generation === this.generation) return cached.view;
    const clone = {
      ...layer,
      childIds: [...layer.childIds],
      state: layerHandler(layer).state.clone(layer.state as never),
    } as Layer;
    const state = clone.state as { constrainAspect?: boolean };
    const constrain = state && typeof state === 'object' ? state.constrainAspect : undefined;
    if (constrain !== undefined) state.constrainAspect = false;
    for (const id of link.linkedParameterIds) {
      const resolved = this.effectiveValue(clone, id);
      const parameter = parameterById(clone, id);
      if (parameter) applyLayerProps(clone, parameter.write(clone, clone.state, resolved.value));
    }
    if (constrain !== undefined) state.constrainAspect = constrain;
    this.viewCache.set(layer, { generation: this.generation, view: clone });
    return clone;
  }

  private rebuildIndex(): void {
    const { pageOrder, activePageId } = this.engine.pages;
    const layers = this.engine.layerService.layers;
    const context = JSON.stringify([
      activePageId,
      this.engine.getPageSpec().ppi,
      pageOrder,
      layers.map((layer) => [layer.id, layer.parameterLink ? addrKey(layer.parameterLink.source) : '']),
    ]);
    const sources = layers.map((layer) =>
      layer.parameterLink ? addrKey(layer.parameterLink.source) : '',
    );
    if (
      context === this.indexedContext &&
      layers.length === this.entriesByKey.size
    ) {
      let same = true;
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        if (!layer) {
          same = false;
          break;
        }
        const key = addrKey({ pageId: activePageId, layerId: layer.id });
        const source = sources[i];
        if (this.entriesByKey.get(key)?.liveLayer !== layer || source !== (layer.parameterLink ? addrKey(layer.parameterLink.source) : '')) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    this.indexedContext = context;
    this.entriesByKey.clear();
    this.targetsBySource.clear();
    for (const entry of this.collectRecords()) {
      const key = addrKey(entry.address);
      this.entriesByKey.set(key, entry);
      const source = entry.host.parameterLink?.source;
      if (!source) continue;
      const list = this.targetsBySource.get(addrKey(source)) ?? [];
      list.push(key);
      this.targetsBySource.set(addrKey(source), list);
    }
  }

  private collectRecords(): RecordEntry[] {
    const result: RecordEntry[] = [];
    for (const pageId of this.engine.pages.pageOrder) {
      if (pageId === this.engine.pages.activePageId) {
        for (const layer of this.engine.layerService.layers) {
          result.push({
            address: { pageId, layerId: layer.id },
            host: layer,
            ppi: this.engine.getPageSpec().ppi,
            live: true,
            liveLayer: layer,
          });
        }
      } else {
        const page = this.document().getPage(pageId);
        if (!page) continue;
        for (const layer of page.layers) {
          result.push({
            address: { pageId, layerId: layer.id },
            host: hostFromOwned(layer),
            ppi: page.spec.ppi,
            live: false,
            owned: layer,
          });
        }
      }
    }
    return result;
  }

  private records(): RecordEntry[] {
    this.rebuildIndex();
    return [...this.entriesByKey.values()];
  }

  private find(address: LayerAddress): RecordEntry | undefined {
    this.rebuildIndex();
    return this.entryAt(address);
  }

  private apply(entry: RecordEntry, props: LayerProps): void {
    if (entry.live && entry.liveLayer)
      this.engine.layerService.assignProps(entry.liveLayer, props);
    else if (entry.owned) {
      if (props.name !== undefined) entry.owned.common.name = props.name;
      if (props.opacity !== undefined) entry.owned.common.opacity = props.opacity;
      if (props.blend !== undefined) entry.owned.common.blend = props.blend;
      if (props.visible !== undefined) entry.owned.common.visible = props.visible;
      if (props.parameterLink !== undefined) {
        entry.owned.common.parameterLink = props.parameterLink
          ? structuredClone(props.parameterLink)
          : undefined;
      }
      if (props.state !== undefined) {
        const mod = findLayerModule(entry.owned.type);
        entry.owned.state = mod
          ? mod.definition.state.applyPatch(entry.owned.state as never, props.state as never)
          : props.state;
      }
      entry.host = hostFromOwned(entry.owned);
      this.document().setLayer(entry.address, entry.owned);
    }
    this.invalidate();
  }

  private bake(entry: RecordEntry, semanticIds: string[]): void {
    for (const id of semanticIds) {
      const resolved = resolveParameterValue(
        this.lookup(),
        { address: entry.address, host: entry.host, ppi: entry.ppi },
        id,
        entry.ppi,
      );
      const parameter = parameterById(entry.host, id);
      if (parameter) this.apply(entry, parameter.write(entry.host, entry.host.state, resolved.value));
    }
  }

  private wouldCycle(target: LayerAddress, source: LayerAddress): boolean {
    let current: LayerAddress | undefined = source;
    const visited = new Set<string>();
    while (current) {
      if (sameAddress(current, target)) return true;
      const key = addrKey(current);
      if (visited.has(key)) return true;
      visited.add(key);
      current = this.find(current)?.host.parameterLink?.source;
    }
    return false;
  }

  private common(source: RecordEntry, target: RecordEntry): string[] {
    const sourceMap = linkableParameterMap(source.host);
    const targetMap = linkableParameterMap(target.host);
    return [...sourceMap.keys()].filter((id) => targetMap.has(id));
  }

  private makeLink(
    target: RecordEntry,
    sourceAddress: LayerAddress,
    onlyEqual: boolean,
    hint?: { name: string; pageIndex: number },
  ): LayerParameterLink {
    const source = this.find(sourceAddress);
    const sourcePageIndex = Math.max(
      0,
      this.engine.pages.pageOrder.indexOf(sourceAddress.pageId),
    );
    const link: LayerParameterLink = {
      source: { ...sourceAddress },
      sourceNameHint: source?.host.name ?? hint?.name ?? '削除済みレイヤー',
      sourcePageIndexHint: source
        ? sourcePageIndex
        : (hint?.pageIndex ?? sourcePageIndex),
      linkedParameterIds: [],
    };
    const sourceMap = source ? linkableParameterMap(source.host) : new Map();
    const targetMap = linkableParameterMap(target.host);
    const ids = source ? this.common(source, target) : [...targetMap.keys()];
    for (const id of ids) {
      const sourceValue = source && sourceMap.get(id)
        ? readCanonicalParameter(sourceMap.get(id)!, source.host, source.ppi)
        : readCanonicalParameter(targetMap.get(id)!, target.host, target.ppi);
      const targetValue = readCanonicalParameter(targetMap.get(id)!, target.host, target.ppi);
      if (sourceValue === null && !targetMap.get(id)!.nullable) continue;
      if (onlyEqual && !parameterValuesEqual(sourceValue, targetValue)) continue;
      link.linkedParameterIds.push(id);
    }
    return link;
  }

  createPasteLink(
    targetLayerId: string,
    source: LayerAddress,
    hint?: { name: string; pageIndex: number },
  ): void {
    this.rebuildIndex();
    const target = this.find(this.currentAddress(targetLayerId));
    if (!target) return;
    this.apply(target, { parameterLink: this.makeLink(target, source, false, hint) });
  }

  async changeSource(targetLayerId: string, source: LayerAddress): Promise<void> {
    this.rebuildIndex();
    const targetAddress = this.currentAddress(targetLayerId);
    const target = this.find(targetAddress);
    if (!target || this.wouldCycle(targetAddress, source)) return;
    const before = cloneLink(target.host.parameterLink);
    const after = this.makeLink(target, source, true);
    this.apply(target, { parameterLink: after });
    this.engine.history.push(
      { kind: 'layerLink', target: targetAddress, before, after: cloneLink(after) },
      'リンク元を変更',
    );
    this.engine.committed();
  }

  removeLink(targetLayerId: string): void {
    const targetAddress = this.currentAddress(targetLayerId);
    const target = this.find(targetAddress);
    if (!target?.host.parameterLink) return;
    const before = cloneLink(target.host.parameterLink);
    this.bake(target, target.host.parameterLink.linkedParameterIds);
    this.apply(target, { parameterLink: null });
    this.engine.history.push(
      { kind: 'layerLink', target: targetAddress, before, after: null },
      'パラメータリンクを解除',
    );
    this.engine.committed();
  }

  unlinkParameter(targetLayerId: string, semanticId: string): void {
    this.unlinkParameters([targetLayerId], semanticId);
  }

  unlinkParameters(targetLayerIds: string[], semanticId: string): void {
    const ops = targetLayerIds.flatMap((targetLayerId) => {
      const targetAddress = this.currentAddress(targetLayerId);
      const target = this.find(targetAddress);
      const current = target?.host.parameterLink;
      if (!target || !current?.linkedParameterIds.includes(semanticId)) return [];
      const before = cloneLink(current)!;
      this.bake(target, [semanticId]);
      const after = cloneLink(target.host.parameterLink)!;
      after.linkedParameterIds = after.linkedParameterIds.filter((id) => id !== semanticId);
      this.apply(target, { parameterLink: after.linkedParameterIds.length ? after : null });
      return [{ kind: 'layerLink' as const, target: targetAddress, before, after: cloneLink(after.linkedParameterIds.length ? after : null) }];
    });
    if (!ops.length) return;
    this.engine.history.push(ops.length === 1 ? ops[0] : { kind: 'batch', ops }, 'パラメータのリンクを解除');
    this.engine.committed();
  }

  async relink(targetLayerId: string, semanticId?: string): Promise<void> {
    this.rebuildIndex();
    const targetAddress = this.currentAddress(targetLayerId);
    const target = this.find(targetAddress);
    const current = target?.host.parameterLink;
    const source = current ? this.find(current.source) : undefined;
    if (!target || !current || !source) return;
    const before = cloneLink(current);
    const next = cloneLink(current)!;
    const ids = semanticId ? [semanticId] : this.common(source, target);
    for (const id of ids) {
      if (!next.linkedParameterIds.includes(id)) next.linkedParameterIds.push(id);
    }
    this.apply(target, { parameterLink: next });
    this.engine.history.push(
      { kind: 'layerLink', target: targetAddress, before, after: cloneLink(next) },
      semanticId ? 'パラメータを再リンク' : 'すべて再リンク',
    );
    this.engine.committed();
  }

  detachChanged(
    layer: Layer,
    before: ParameterHost,
    after: ParameterHost,
    _preserveIfSourceMatches = false,
  ): { before: LayerParameterLink; after: LayerParameterLink } | null {
    if (!layer.parameterLink) return null;
    const ppi = this.engine.getPageSpec().ppi;
    const beforeMap = linkableParameterMap(before);
    const afterMap = linkableParameterMap(after);
    const old = cloneLink(layer.parameterLink)!;
    const next = cloneLink(layer.parameterLink)!;
    next.linkedParameterIds = next.linkedParameterIds.filter((id) => {
      const a = beforeMap.get(id);
      const b = afterMap.get(id);
      if (!a || !b) return false;
      return parameterValuesEqual(
        readCanonicalParameter(a, before, ppi),
        readCanonicalParameter(b, after, ppi),
      );
    });
    return JSON.stringify(old) === JSON.stringify(next) ? null : { before: old, after: next };
  }

  propagateFrom(sourceAddress: LayerAddress, _preview = false): import('../history/historyTree').LayerLinkOp[] {
    this.invalidateViews();
    if (!this.indexedContext) this.rebuildIndex();
    const queue = [addrKey(sourceAddress)];
    const seen = new Set<string>();
    while (queue.length) {
      const key = queue.shift()!;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const targetKey of this.targetsBySource.get(key) ?? []) {
        const target = this.entriesByKey.get(targetKey);
        if (!target) continue;
        if (target.live && target.liveLayer) this.engine.layerService.bumpLayer?.(target.liveLayer.id);
        queue.push(targetKey);
      }
    }
    return [];
  }

  reconcileAll(): void {
    this.invalidate();
  }

  applyHistoryLink(targetAddress: LayerAddress, link: LayerParameterLink | null): void {
    const target = this.find(targetAddress);
    if (!target) return;
    this.apply(target, { parameterLink: link });
  }

  candidates(targetLayerId: string): LayerLinkCandidate[] {
    this.rebuildIndex();
    const targetAddress = this.currentAddress(targetLayerId);
    const target = this.find(targetAddress);
    if (!target) return [];
    return this.records().map((source) => {
      const compatible = this.common(source, target);
      const sourceMap = linkableParameterMap(source.host);
      const targetMap = linkableParameterMap(target.host);
      const equalCount = compatible.filter((id) =>
        parameterValuesEqual(
          readCanonicalParameter(sourceMap.get(id)!, source.host, source.ppi),
          readCanonicalParameter(targetMap.get(id)!, target.host, target.ppi),
        ),
      ).length;
      return {
        address: source.address,
        name: source.host.name,
        pageIndex: this.engine.pages.pageOrder.indexOf(source.address.pageId),
        type: source.host.type,
        compatibleCount: compatible.length,
        equalCount,
        disabledReason: sameAddress(source.address, targetAddress)
          ? '自分自身です'
          : this.wouldCycle(targetAddress, source.address)
            ? '循環参照になります'
            : undefined,
      };
    });
  }

  infosFor(layerIds: string[]): Map<string, ReturnType<ParameterLinkService['infoFor']>> {
    this.rebuildIndex();
    return new Map(layerIds.map((id) => [id, this.indexedInfoFor(id)]));
  }

  infoFor(layerId: string): ReturnType<ParameterLinkService['indexedInfoFor']> {
    this.rebuildIndex();
    return this.indexedInfoFor(layerId);
  }

  private indexedInfoFor(layerId: string): {
    source?: LayerLinkEndpointSummary;
    targets: LayerLinkEndpointSummary[];
    compatibleIds: string[];
  } {
    const address = this.currentAddress(layerId);
    const target = this.entryAt(address);
    const link = target?.host.parameterLink;
    const sourceEntry = link ? this.find(link.source) : undefined;
    const source = link
      ? {
          address: { ...link.source },
          name: sourceEntry?.host.name ?? link.sourceNameHint,
          pageIndex: sourceEntry
            ? this.engine.pages.pageOrder.indexOf(sourceEntry.address.pageId)
            : link.sourcePageIndexHint,
          linkedCount: link.linkedParameterIds.length,
          missing: !sourceEntry,
        }
      : undefined;
    const targetKeys = this.targetsBySource.get(addrKey(address)) ?? [];
    const targets = targetKeys.flatMap((key) => {
      const entry = this.entriesByKey.get(key);
      return entry?.host.parameterLink
        ? [{
            address: { ...entry.address },
            name: entry.host.name,
            pageIndex: this.engine.pages.pageOrder.indexOf(entry.address.pageId),
            linkedCount: entry.host.parameterLink.linkedParameterIds.length,
          }]
        : [];
    });
    return {
      source,
      targets,
      compatibleIds: sourceEntry && target ? this.common(sourceEntry, target) : [],
    };
  }
}

export { layerTypeProps };
