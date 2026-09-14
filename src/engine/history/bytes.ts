import type { Op, PersistedAtomicOp, PersistedOp } from './historyTree';
import { assetBytes, collectAssetIds } from '../raster/RasterAssetRepository';

/** Count immutable raster assets once even when many snapshots/branches share them. */
export function payloadBytes(
  value: unknown,
  seenAssets = new Set<string>(),
  includeAssets = true,
): number {
  let bytes = 0;
  if (includeAssets)
    for (const id of collectAssetIds(value)) {
      if (!seenAssets.has(id)) {
        seenAssets.add(id);
        bytes += assetBytes(id);
      }
    }
  const seen = new WeakSet<object>();
  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);
    if (item instanceof Blob) {
      bytes += item.size;
      return;
    }
    if (
      typeof HTMLCanvasElement !== 'undefined' &&
      item instanceof HTMLCanvasElement
    ) {
      bytes += item.width * item.height * 4;
      return;
    }
    for (const child of Object.values(item)) visit(child);
  };
  visit(value);
  return bytes;
}
export function atomicBytes(
  op: PersistedAtomicOp | Exclude<Op, { kind: 'batch' }>,
): number {
  return payloadBytes(op);
}
export function opBytes(
  op: PersistedOp | Op | null,
  seenAssets = new Set<string>(),
): number {
  return payloadBytes(op, seenAssets);
}
