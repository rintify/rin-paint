export type DocumentAddress =
  | { kind: 'page'; id: string }
  | { kind: 'bin'; id: string };

/** Stable address of one occurrence, including a sealed Canvas scope path. */
export interface LayerAddress {
  document: DocumentAddress;
  scopePath: string[];
  nodeId: string;
}

/** Compatibility name for entity code; both now use the same public address. */
export type ScopedLayerAddress = LayerAddress;

export function scopedAddressKey(address: LayerAddress): string {
  return `${address.document.kind}:${address.document.id}/${address.scopePath.join('/')}/${address.nodeId}`;
}

export function canLinkDocuments(target: DocumentAddress, source: DocumentAddress): boolean {
  return target.kind === 'page' || source.kind === 'bin';
}
