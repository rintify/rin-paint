import {
  canLinkDocuments,
  scopedAddressKey,
  type LayerAddress,
  type LayerLinkEndpointSummary,
  type LayerParameterLink,
  type SemanticParameterValue,
} from '../../model';
import { useStore } from '../../state/store';
import {
  linkableParameterMap,
  parameterValuesEqual,
  readCanonicalParameter,
  writeCanonicalParameter,
} from '../layerParameters';
import type { Layer } from '../layers';
import { applyRecordProps, layerTypeProps } from '../layer-types/registry';
import type { LayerProps } from '../layer-types/definition';
import { hostFromRecord, type ParameterHost } from '../parameters/host';
import { loadPage, saveBinItem, savePage, type SavedBinItem, type SavedLayer, type SavedPage } from '../persistence/db';
import type { PaintEngine } from '../PaintEngine';
import { savedCanvasScopePath } from '../entities/linkedRecords';

export interface LayerLinkCandidate {
  address: LayerAddress;
  name: string;
  pageIndex: number;
  documentLabel: string;
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
  return scopedAddressKey(address);
}

function sameAddress(a: LayerAddress, b: LayerAddress): boolean {
  return addrKey(a) === addrKey(b);
}

function sameScope(a: LayerAddress, b: LayerAddress): boolean {
  if (a.scopePath.length === 0 && b.scopePath.length === 0) return true;
  return a.document.kind === b.document.kind
    && a.document.id === b.document.id
    && a.scopePath.join('\0') === b.scopePath.join('\0');
}

function cloneLink(link: LayerParameterLink | undefined | null): LayerParameterLink | null {
  return link ? structuredClone(link) : null;
}

/** Owns the project-wide one-way parameter-link graph and materialized values. */
export class ParameterLinkService {
  private pages = new Map<string, SavedPage>();
  private pending: Promise<void> = Promise.resolve();
  private entriesByKey = new Map<string, RecordEntry>();
  private targetsBySource = new Map<string, string[]>();

  constructor(private engine: PaintEngine) {}

  async refreshCatalog(): Promise<void> {
    const loaded = await Promise.all(this.engine.pages.pageOrder.map(id => loadPage(id)));
    this.pages = new Map(loaded.filter((page): page is SavedPage => !!page).map(page => [page.id, page]));
    this.rebuildIndex();
  }

  noteSavedPage(page: SavedPage): void {
    this.pages.set(page.id, structuredClone(page));
    this.rebuildIndex();
  }

  removePage(pageId: string): void {
    this.pages.delete(pageId);
    this.rebuildIndex();
  }

  flush(): Promise<void> { return this.pending; }

  private currentAddress(layerId: string): LayerAddress {
    const state = useStore.getState();
    const editing = state.editingDocument?.id
      ? state.editingDocument
      : { kind: 'page' as const, id: this.engine.pages.activePageId };
    const scopePath: string[] = [];
    const byId = (id: string) => (this.engine.layerService as unknown as { byId?: (value: string) => Layer | null }).byId?.(id)
      ?? this.engine.layerService.layers.find(layer => layer.id === id) ?? null;
    let current = byId(layerId);
    while (current?.scopeId) {
      scopePath.unshift(current.scopeId);
      current = byId(current.scopeId);
    }
    return { document: editing, scopePath, nodeId: layerId };
  }

  private rebuildIndex(): void {
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
    const state = useStore.getState();
    const editing = state.editingDocument?.id
      ? state.editingDocument
      : { kind: 'page' as const, id: this.engine.pages.activePageId };
    for (const pageId of this.engine.pages.pageOrder) {
      if (editing.kind === 'page' && pageId === editing.id) {
        for (const layer of this.engine.layerService.layers) {
          result.push({
            address: this.currentAddress(layer.id),
            host: layer,
            ppi: this.engine.getPageSpec().ppi,
            live: true,
            liveLayer: layer,
          });
        }
      } else {
        const page = this.pages.get(pageId);
        if (!page) continue;
        for (const layer of page.layers) {
          result.push({
            address: { document: { kind: 'page', id: pageId }, scopePath: savedCanvasScopePath(layer.id, page.layers), nodeId: layer.id },
            host: hostFromRecord(layer, page.pageSpec.ppi),
            ppi: page.pageSpec.ppi,
            live: false,
            stored: layer,
          });
        }
      }
    }
    const bins = ((this.engine as unknown as { bins?: { items?: SavedBinItem[] } }).bins?.items ?? []);
    for (const bin of bins) {
      if (editing.kind === 'bin' && editing.id === bin.id) {
        for (const layer of this.engine.layerService.layers) result.push({
          address: this.currentAddress(layer.id), host: layer, ppi: this.engine.getPageSpec().ppi,
          live: true, liveLayer: layer,
        });
      } else for (const layer of bin.layers) result.push({
        address: { document: { kind: 'bin', id: bin.id }, scopePath: savedCanvasScopePath(layer.id, bin.layers), nodeId: layer.id },
        host: hostFromRecord(layer, bin.ppi), ppi: bin.ppi, live: false, stored: layer,
      });
    }
    return result;
  }

  private records(): RecordEntry[] {
    this.rebuildIndex();
    return [...this.entriesByKey.values()];
  }

  private find(address: LayerAddress): RecordEntry | undefined {
    if (!this.entriesByKey.size) this.rebuildIndex();
    return this.entriesByKey.get(addrKey(address)) ?? this.records().find(entry => sameAddress(entry.address, address));
  }

  private apply(entry: RecordEntry, props: LayerProps): void {
    if (entry.live && entry.liveLayer) this.engine.layerService.assignProps(entry.liveLayer, props);
    else if (entry.stored) {
      applyRecordProps(entry.stored, props, entry.ppi);
      entry.host = hostFromRecord(entry.stored, entry.ppi);
    }
    this.rebuildIndex();
  }

  private enqueueSaves(addresses: Set<string>): void {
    if (!addresses.size) return;
    const pages = [...addresses].filter(key => key.startsWith('page:')).map(key => this.pages.get(key.slice(5))).filter((page): page is SavedPage => !!page);
    const bins = ((this.engine as unknown as { bins?: { items?: SavedBinItem[] } }).bins?.items ?? [])
      .filter(bin => addresses.has(`bin:${bin.id}`));
    this.pending = this.pending.then(async () => {
      for (const page of pages) await savePage(page);
      for (const bin of bins) await saveBinItem(bin);
    }).catch(() => {
      useStore.getState().set({ toolNotice: '別ページのリンク更新を保存できませんでした。ページ表示時に再同期します。' });
    });
  }

  private common(source: RecordEntry, target: RecordEntry): string[] {
    const sourceMap = linkableParameterMap(source.host);
    const targetMap = linkableParameterMap(target.host);
    return [...sourceMap.keys()].filter(id => {
      const value = readCanonicalParameter(sourceMap.get(id)!, source.host, source.ppi);
      return targetMap.has(id) && (value !== null || targetMap.get(id)!.nullable === true);
    });
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

  private makeLink(
    target: RecordEntry,
    sourceAddress: LayerAddress,
    onlyEqual: boolean,
    hint?: { name: string; pageIndex: number },
  ): LayerParameterLink {
    const source = this.find(sourceAddress);
    const sourcePageIndex = sourceAddress.document.kind === 'page'
      ? Math.max(0, this.engine.pages.pageOrder.indexOf(sourceAddress.document.id)) : -1;
    const link: LayerParameterLink = {
      source: { ...sourceAddress },
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
        ? readCanonicalParameter(sourceMap.get(id)!, source.host, source.ppi)
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
    if (!target || !canLinkDocuments(target.address.document, source.document) || !sameScope(target.address, source)) return;
    const link = this.makeLink(target, source, false, hint);
    this.apply(target, { parameterLink: link });
    this.propagateFrom(source);
  }

  async changeSource(targetLayerId: string, source: LayerAddress): Promise<void> {
    await this.flush();
    this.rebuildIndex();
    const targetAddress = this.currentAddress(targetLayerId);
    const target = this.find(targetAddress);
    if (!target || !canLinkDocuments(targetAddress.document, source.document)
      || !sameScope(targetAddress, source) || this.wouldCycle(targetAddress, source)) return;
    const before = cloneLink(target.host.parameterLink);
    const after = this.makeLink(target, source, true);
    this.apply(target, { parameterLink: after });
    this.engine.history.push({ kind: 'layerLink', target: targetAddress, before, after: cloneLink(after) }, 'リンク元を変更');
    this.propagateFrom(source);
    this.engine.committed();
  }

  removeLink(targetLayerId: string): void {
    const targetAddress = this.currentAddress(targetLayerId);
    const target = this.find(targetAddress);
    if (!target?.host.parameterLink) return;
    const before = cloneLink(target.host.parameterLink);
    this.apply(target, { parameterLink: null });
    this.engine.history.push({ kind: 'layerLink', target: targetAddress, before, after: null }, 'パラメータリンクを解除');
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
      const value = readCanonicalParameter(sourceDescriptor, source.host, source.ppi);
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
    next.linkedParameterIds = next.linkedParameterIds.filter(id => {
      const a = beforeMap.get(id), b = afterMap.get(id);
      if (!a || !b) { delete next.fallbackValues[id]; return false; }
      const afterValue = readCanonicalParameter(b, after, ppi);
      let changed = !parameterValuesEqual(readCanonicalParameter(a, before, ppi), afterValue);
      if (changed && preserveIfSourceMatches) {
        const source = this.find(old.source);
        const sourceDescriptor = source && linkableParameterMap(source.host).get(id);
        if (source && sourceDescriptor) changed = !parameterValuesEqual(
          readCanonicalParameter(sourceDescriptor, source.host, source.ppi),
          afterValue,
        );
      }
      if (changed) delete next.fallbackValues[id];
      return !changed;
    });
    return JSON.stringify(old) === JSON.stringify(next) ? null : { before: old, after: next };
  }

  propagateFrom(sourceAddress: LayerAddress, preview = false): import('../history/historyTree').LayerLinkOp[] {
    this.rebuildIndex();
    const dirtyDocuments = new Set<string>();
    const linkChanges: import('../history/historyTree').LayerLinkOp[] = [];
    const queue = [sourceAddress];
    const visitedEdges = new Set<string>();
    while (queue.length) {
      const sourceAddressNow = queue.shift()!;
      const source = this.find(sourceAddressNow);
      if (!source) continue;
      const targetKeys = this.targetsBySource.get(addrKey(sourceAddressNow)) ?? [];
      for (const targetKey of targetKeys) {
        const target = this.entriesByKey.get(targetKey);
        const link = target?.host.parameterLink;
        if (!target || !link || !sameAddress(link.source, sourceAddressNow)) continue;
        const edge = `${addrKey(sourceAddressNow)}>${addrKey(target.address)}`;
        if (visitedEdges.has(edge)) {
          if (!preview) useStore.getState().set({ toolNotice: '破損した循環パラメータリンクを検出し、伝播を停止しました。' });
          continue;
        }
        visitedEdges.add(edge);
        if (preview && !target.live) continue;
        const sourceMap = linkableParameterMap(source.host), targetMap = linkableParameterMap(target.host);
        const beforeLink = cloneLink(link)!;
        const next = cloneLink(link)!;
        next.sourceNameHint = source.host.name;
        next.sourcePageIndexHint = source.address.document.kind === 'page'
          ? this.engine.pages.pageOrder.indexOf(source.address.document.id) : -1;
        let changed = false;
        next.linkedParameterIds = next.linkedParameterIds.filter(id => {
          const sourceDescriptor = sourceMap.get(id), targetDescriptor = targetMap.get(id);
          if (!sourceDescriptor || !targetDescriptor) { delete next.fallbackValues[id]; changed = true; return false; }
          const value = readCanonicalParameter(sourceDescriptor, source.host, source.ppi);
          if (value === null && targetDescriptor.nullable !== true) { delete next.fallbackValues[id]; changed = true; return false; }
          const current = readCanonicalParameter(targetDescriptor, target.host, target.ppi);
          if (!parameterValuesEqual(current, value)) {
            this.apply(target, writeCanonicalParameter(targetDescriptor, target.host, value, target.ppi));
            changed = true;
          }
          next.fallbackValues[id] = value as SemanticParameterValue;
          return true;
        });
        if (!preview) {
          this.apply(target, { parameterLink: next });
          if (beforeLink.linkedParameterIds.join('\0') !== next.linkedParameterIds.join('\0')) {
            linkChanges.push({
              kind: 'layerLink', target: { ...target.address }, before: beforeLink, after: cloneLink(next),
            });
          }
        }
        if (changed || !preview) {
          if (!target.live) dirtyDocuments.add(`${target.address.document.kind}:${target.address.document.id}`);
          queue.push(target.address);
        }
      }
    }
    if (!preview) this.enqueueSaves(dirtyDocuments);
    return linkChanges;
  }

  reconcileAll(): void {
    this.rebuildIndex();
    for (const entry of this.records()) if (entry.host.parameterLink && this.find(entry.host.parameterLink.source)) {
      this.propagateFrom(entry.host.parameterLink.source);
    }
  }

  applyHistoryLink(targetAddress: LayerAddress, link: LayerParameterLink | null): void {
    const target = this.find(targetAddress);
    if (!target) return;
    this.apply(target, { parameterLink: link });
    if (!target.live) this.enqueueSaves(new Set([`${targetAddress.document.kind}:${targetAddress.document.id}`]));
  }

  candidates(targetLayerId: string): LayerLinkCandidate[] {
    this.rebuildIndex();
    const targetAddress = this.currentAddress(targetLayerId);
    const target = this.find(targetAddress);
    if (!target) return [];
    return this.records().map(source => {
      const compatible = this.common(source, target);
      const sourceMap = linkableParameterMap(source.host), targetMap = linkableParameterMap(target.host);
      const equalCount = compatible.filter(id => parameterValuesEqual(
        readCanonicalParameter(sourceMap.get(id)!, source.host, source.ppi),
        readCanonicalParameter(targetMap.get(id)!, target.host, target.ppi),
      )).length;
      return {
        address: source.address,
        name: source.host.name,
        pageIndex: source.address.document.kind === 'page'
          ? this.engine.pages.pageOrder.indexOf(source.address.document.id) : -1,
        documentLabel: source.address.document.kind === 'page'
          ? `ページ ${this.engine.pages.pageOrder.indexOf(source.address.document.id) + 1}` : 'ビン',
        type: source.host.type,
        compatibleCount: compatible.length,
        equalCount,
        disabledReason: sameAddress(source.address, targetAddress) ? '自分自身です'
          : !canLinkDocuments(targetAddress.document, source.address.document)
            ? 'ビン内からページのレイヤーは参照できません'
          : !sameScope(source.address, targetAddress)
            ? 'キャンバスレイヤーの描画スコープを越えて参照できません'
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
      pageIndex: sourceEntry?.address.document.kind === 'page'
        ? this.engine.pages.pageOrder.indexOf(sourceEntry.address.document.id) : link.sourcePageIndexHint,
      linkedCount: link.linkedParameterIds.length,
      missing: !sourceEntry,
    } : undefined;
    const targetKeys = this.targetsBySource.get(addrKey(address)) ?? [];
    const targets = targetKeys.flatMap(key => {
      const entry = this.entriesByKey.get(key);
      return entry?.host.parameterLink ? [{
        address: { ...entry.address },
        name: entry.host.name,
        pageIndex: entry.address.document.kind === 'page'
          ? this.engine.pages.pageOrder.indexOf(entry.address.document.id) : -1,
        linkedCount: entry.host.parameterLink.linkedParameterIds.length,
      }] : [];
    });
    return { source, targets, compatibleIds: sourceEntry && target ? this.common(sourceEntry, target) : [] };
  }
}
