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
import type { LayerParameterLayer } from '../layer-types/types';
import type { Layer } from '../layers';
import { layerTypeProps } from '../layer-types/registry';
import { loadPage, savePage, type SavedLayer, type SavedPage } from '../persistence/db';
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
  layer: LayerParameterLayer;
  ppi: number;
  live: boolean;
}

function sameAddress(a: LayerAddress, b: LayerAddress): boolean {
  return a.pageId === b.pageId && a.layerId === b.layerId;
}

function cloneLink(link: LayerParameterLink | undefined | null): LayerParameterLink | null {
  return link ? structuredClone(link) : null;
}

function assignStored(layer: SavedLayer, props: Record<string, unknown>): void {
      for (const key of ['name', 'opacity', 'blend', 'visible', 'params', 'outline', 'maskLayerIds', 'shape', 'snapEnabled', 'constrainAspect', 'text', 'image'] as const) {
    if (props[key] !== undefined) (layer as unknown as Record<string, unknown>)[key] = structuredClone(props[key]);
  }
  if (props.parameterLink !== undefined) {
    layer.parameterLink = props.parameterLink ? structuredClone(props.parameterLink as LayerParameterLink) : undefined;
  }
}

/** Owns the project-wide one-way parameter-link graph and materialized values. */
export class ParameterLinkService {
  private pages = new Map<string, SavedPage>();
  private pending: Promise<void> = Promise.resolve();

  constructor(private engine: PaintEngine) {}

  async refreshCatalog(): Promise<void> {
    const loaded = await Promise.all(this.engine.pages.pageOrder.map(id => loadPage(id)));
    this.pages = new Map(loaded.filter((page): page is SavedPage => !!page).map(page => [page.id, page]));
  }

  noteSavedPage(page: SavedPage): void {
    this.pages.set(page.id, structuredClone(page));
  }

  removePage(pageId: string): void { this.pages.delete(pageId); }

  flush(): Promise<void> { return this.pending; }

  private currentAddress(layerId: string): LayerAddress {
    return { pageId: this.engine.pages.activePageId, layerId };
  }

  private records(): RecordEntry[] {
    const result: RecordEntry[] = [];
    for (const pageId of this.engine.pages.pageOrder) {
      if (pageId === this.engine.pages.activePageId) {
        for (const layer of this.engine.layerService.layers) {
          result.push({ address: { pageId, layerId: layer.id }, layer, ppi: this.engine.getCanvasSpec().ppi, live: true });
        }
      } else {
        const page = this.pages.get(pageId);
        if (!page) continue;
        for (const layer of page.layers) {
          result.push({ address: { pageId, layerId: layer.id }, layer: layer as unknown as LayerParameterLayer, ppi: page.canvasSpec.ppi, live: false });
        }
      }
    }
    return result;
  }

  private find(address: LayerAddress): RecordEntry | undefined {
    return this.records().find(entry => sameAddress(entry.address, address));
  }

  private apply(entry: RecordEntry, props: object): void {
    if (entry.live) this.engine.layerService.assignProps(entry.layer as Layer, props);
    else assignStored(entry.layer as unknown as SavedLayer, props as Record<string, unknown>);
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
    const sourceMap = linkableParameterMap(source.layer);
    const targetMap = linkableParameterMap(target.layer);
    return [...sourceMap.keys()].filter(id => {
      const value = readCanonicalParameter(sourceMap.get(id)!, source.layer, source.ppi);
      return targetMap.has(id) && (value !== null || targetMap.get(id)!.nullable === true);
    });
  }

  private wouldCycle(target: LayerAddress, source: LayerAddress): boolean {
    let current: LayerAddress | undefined = source;
    const visited = new Set<string>();
    while (current) {
      if (sameAddress(current, target)) return true;
      const key = `${current.pageId}:${current.layerId}`;
      if (visited.has(key)) return true;
      visited.add(key);
      current = this.find(current)?.layer.parameterLink?.source;
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
    const sourcePageIndex = Math.max(0, this.engine.pages.pageOrder.indexOf(sourceAddress.pageId));
    const link: LayerParameterLink = {
      source: { ...sourceAddress },
      sourceNameHint: source?.layer.name ?? hint?.name ?? '削除済みレイヤー',
      sourcePageIndexHint: source ? sourcePageIndex : hint?.pageIndex ?? sourcePageIndex,
      linkedParameterIds: [],
      fallbackValues: {},
    };
    const sourceMap = source ? linkableParameterMap(source.layer) : new Map();
    const targetMap = linkableParameterMap(target.layer);
    const ids = source ? this.common(source, target) : [...targetMap.keys()];
    for (const id of ids) {
      const sourceValue = source && sourceMap.get(id)
        ? readCanonicalParameter(sourceMap.get(id)!, source.layer, source.ppi)
        : readCanonicalParameter(targetMap.get(id)!, target.layer, target.ppi);
      const targetValue = readCanonicalParameter(targetMap.get(id)!, target.layer, target.ppi);
      if (sourceValue === null && targetMap.get(id)!.nullable !== true) continue;
      if (onlyEqual && !parameterValuesEqual(sourceValue, targetValue)) continue;
      link.linkedParameterIds.push(id);
      link.fallbackValues[id] = sourceValue as SemanticParameterValue;
    }
    return link;
  }

  createPasteLink(targetLayerId: string, source: LayerAddress, hint?: { name: string; pageIndex: number }): void {
    const target = this.find(this.currentAddress(targetLayerId));
    if (!target) return;
    const link = this.makeLink(target, source, false, hint);
    this.apply(target, { parameterLink: link });
    this.propagateFrom(source);
  }

  async changeSource(targetLayerId: string, source: LayerAddress): Promise<void> {
    await this.flush();
    const targetAddress = this.currentAddress(targetLayerId);
    const target = this.find(targetAddress);
    if (!target || this.wouldCycle(targetAddress, source)) return;
    const before = cloneLink(target.layer.parameterLink);
    const after = this.makeLink(target, source, true);
    this.apply(target, { parameterLink: after });
    this.engine.history.push({ kind: 'layerLink', target: targetAddress, before, after: cloneLink(after) }, 'リンク元を変更');
    this.propagateFrom(source);
    this.engine.committed();
  }

  removeLink(targetLayerId: string): void {
    const targetAddress = this.currentAddress(targetLayerId);
    const target = this.find(targetAddress);
    if (!target?.layer.parameterLink) return;
    const before = cloneLink(target.layer.parameterLink);
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
      const current = target?.layer.parameterLink;
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
    const targetAddress = this.currentAddress(targetLayerId);
    const target = this.find(targetAddress);
    const current = target?.layer.parameterLink;
    const source = current ? this.find(current.source) : undefined;
    if (!target || !current || !source) return;
    const before = cloneLink(current);
    const beforeProps = target.live ? {
      opacity: target.layer.opacity,
      visible: target.layer.visible,
      blend: target.layer.blend,
      ...layerTypeProps(target.layer as Layer),
    } : {};
    const next = cloneLink(current)!;
    const ids = semanticId ? [semanticId] : this.common(source, target);
    const sourceMap = linkableParameterMap(source.layer);
    const targetMap = linkableParameterMap(target.layer);
    for (const id of ids) {
      const sourceDescriptor = sourceMap.get(id), targetDescriptor = targetMap.get(id);
      if (!sourceDescriptor || !targetDescriptor) continue;
      const value = readCanonicalParameter(sourceDescriptor, source.layer, source.ppi);
      if (value === null && targetDescriptor.nullable !== true) continue;
      this.apply(target, writeCanonicalParameter(targetDescriptor, target.layer, value, target.ppi));
      if (!next.linkedParameterIds.includes(id)) next.linkedParameterIds.push(id);
      next.fallbackValues[id] = value as SemanticParameterValue;
    }
    this.apply(target, { parameterLink: next });
    const afterProps = target.live ? {
      opacity: target.layer.opacity,
      visible: target.layer.visible,
      blend: target.layer.blend,
      ...layerTypeProps(target.layer as Layer),
    } : {};
    this.engine.history.push({ kind: 'batch', ops: [
      { kind: 'layerProps', layerId: targetLayerId, before: beforeProps, after: afterProps },
      { kind: 'layerLink', target: targetAddress, before, after: cloneLink(next) },
    ] }, semanticId ? 'パラメータを再リンク' : 'すべて再リンク');
    this.propagateFrom(targetAddress);
    this.engine.committed();
  }

  detachChanged(layer: Layer, before: LayerParameterLayer, after: LayerParameterLayer, preserveIfSourceMatches = false): { before: LayerParameterLink; after: LayerParameterLink } | null {
    if (!layer.parameterLink) return null;
    const ppi = this.engine.getCanvasSpec().ppi;
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
        const sourceDescriptor = source && linkableParameterMap(source.layer).get(id);
        if (source && sourceDescriptor) changed = !parameterValuesEqual(
          readCanonicalParameter(sourceDescriptor, source.layer, source.ppi),
          afterValue,
        );
      }
      if (changed) delete next.fallbackValues[id];
      return !changed;
    });
    return JSON.stringify(old) === JSON.stringify(next) ? null : { before: old, after: next };
  }

  propagateFrom(sourceAddress: LayerAddress, preview = false): import('../history/historyTree').LayerLinkOp[] {
    const all = this.records();
    const dirtyPages = new Set<string>();
    const linkChanges: import('../history/historyTree').LayerLinkOp[] = [];
    const queue = [sourceAddress];
    const visitedEdges = new Set<string>();
    while (queue.length) {
      const sourceAddressNow = queue.shift()!;
      const source = this.find(sourceAddressNow);
      if (!source) continue;
      for (const target of all) {
        const link = target.layer.parameterLink;
        if (!link || !sameAddress(link.source, sourceAddressNow)) continue;
        const edge = `${sourceAddressNow.pageId}:${sourceAddressNow.layerId}>${target.address.pageId}:${target.address.layerId}`;
        if (visitedEdges.has(edge)) {
          if (!preview) useStore.getState().set({ toolNotice: '破損した循環パラメータリンクを検出し、伝播を停止しました。' });
          continue;
        }
        visitedEdges.add(edge);
        if (preview && !target.live) continue;
        const sourceMap = linkableParameterMap(source.layer), targetMap = linkableParameterMap(target.layer);
        const beforeLink = cloneLink(link)!;
        const next = cloneLink(link)!;
        next.sourceNameHint = source.layer.name;
        next.sourcePageIndexHint = this.engine.pages.pageOrder.indexOf(source.address.pageId);
        let changed = false;
        next.linkedParameterIds = next.linkedParameterIds.filter(id => {
          const sourceDescriptor = sourceMap.get(id), targetDescriptor = targetMap.get(id);
          if (!sourceDescriptor || !targetDescriptor) { delete next.fallbackValues[id]; changed = true; return false; }
          const value = readCanonicalParameter(sourceDescriptor, source.layer, source.ppi);
          if (value === null && targetDescriptor.nullable !== true) { delete next.fallbackValues[id]; changed = true; return false; }
          const current = readCanonicalParameter(targetDescriptor, target.layer, target.ppi);
          if (!parameterValuesEqual(current, value)) {
            this.apply(target, writeCanonicalParameter(targetDescriptor, target.layer, value, target.ppi));
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
          if (!target.live) dirtyPages.add(target.address.pageId);
          queue.push(target.address);
        }
      }
    }
    if (!preview) this.enqueueSaves(dirtyPages);
    return linkChanges;
  }

  reconcileAll(): void {
    for (const entry of this.records()) if (entry.layer.parameterLink && this.find(entry.layer.parameterLink.source)) {
      this.propagateFrom(entry.layer.parameterLink.source);
    }
  }

  applyHistoryLink(targetAddress: LayerAddress, link: LayerParameterLink | null): void {
    const target = this.find(targetAddress);
    if (!target) return;
    this.apply(target, { parameterLink: link });
    if (!target.live) this.enqueueSaves(new Set([targetAddress.pageId]));
  }

  candidates(targetLayerId: string): LayerLinkCandidate[] {
    const targetAddress = this.currentAddress(targetLayerId);
    const target = this.find(targetAddress);
    if (!target) return [];
    return this.records().map(source => {
      const compatible = this.common(source, target);
      const sourceMap = linkableParameterMap(source.layer), targetMap = linkableParameterMap(target.layer);
      const equalCount = compatible.filter(id => parameterValuesEqual(
        readCanonicalParameter(sourceMap.get(id)!, source.layer, source.ppi),
        readCanonicalParameter(targetMap.get(id)!, target.layer, target.ppi),
      )).length;
      return {
        address: source.address,
        name: source.layer.name,
        pageIndex: this.engine.pages.pageOrder.indexOf(source.address.pageId),
        type: source.layer.type,
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
    const address = this.currentAddress(layerId);
    const target = this.find(address);
    const link = target?.layer.parameterLink;
    const sourceEntry = link ? this.find(link.source) : undefined;
    const source = link ? {
      address: { ...link.source },
      name: sourceEntry?.layer.name ?? link.sourceNameHint,
      pageIndex: sourceEntry ? this.engine.pages.pageOrder.indexOf(sourceEntry.address.pageId) : link.sourcePageIndexHint,
      linkedCount: link.linkedParameterIds.length,
      missing: !sourceEntry,
    } : undefined;
    const targets = this.records().filter(entry => entry.layer.parameterLink && sameAddress(entry.layer.parameterLink.source, address)).map(entry => ({
      address: { ...entry.address },
      name: entry.layer.name,
      pageIndex: this.engine.pages.pageOrder.indexOf(entry.address.pageId),
      linkedCount: entry.layer.parameterLink!.linkedParameterIds.length,
    }));
    return { source, targets, compatibleIds: sourceEntry && target ? this.common(sourceEntry, target) : [] };
  }
}
