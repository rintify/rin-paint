import type { LayerType } from '../layerKind';

export type DocumentKey = { kind: 'page' | 'bin-item'; id: string };
export type EntityId = string;
export type OccurrenceId = string;
export type SemanticFieldId = string;
export type FieldValue = null | boolean | number | string | readonly FieldValue[] | { readonly [key: string]: FieldValue };
export type FieldValueMap = Record<SemanticFieldId, FieldValue>;
export interface LayerSourceAddress { document: DocumentKey; entityId: EntityId }
export interface ScopeAddress { document: DocumentKey; scopeId: string }
export interface EditTarget { document: DocumentKey; scope: ScopeAddress }
export interface LayerBinding {
  source: LayerSourceAddress | null;
  linkedFields: SemanticFieldId[];
  localValues: FieldValueMap;
}
export interface Occurrence { id: OccurrenceId; entityId: EntityId }
export interface PlacementOverride { occurrenceId: OccurrenceId; index: number }
export interface Scope {
  id: string;
  children: Occurrence[];
}
export interface CanvasStructure {
  source: LayerSourceAddress | null;
  local: Scope;
  suppressed: OccurrenceId[];
  placements: PlacementOverride[];
  /** Overrides for inherited children; untouched children require no saved entity. */
  overrides: Record<OccurrenceId, LayerEntity>;
}
export interface EntityBase {
  id: EntityId;
  binding: LayerBinding;
}
export type LayerEntity = EntityBase & (
  | { type: 'canvas'; structure: CanvasStructure }
  | { type: Exclude<LayerType, 'canvas'> }
);
export interface StackGroup { id: string; scope: ScopeAddress; memberIds: OccurrenceId[] }
export interface LayerDocument { key: DocumentKey; root: Scope; entities: Record<EntityId, LayerEntity> }
export interface ResolvedOccurrence {
  id: OccurrenceId;
  entity: LayerEntity;
  origin: LayerSourceAddress;
  /** Authored local children of an inline override belong to the overriding document. */
  owner: DocumentKey;
}
export function addressKey(address: LayerSourceAddress): string {
  return JSON.stringify([address.document.kind, address.document.id, address.entityId]);
}
export function sameDocument(a: DocumentKey, b: DocumentKey): boolean {
  return a.kind === b.kind && a.id === b.id;
}
