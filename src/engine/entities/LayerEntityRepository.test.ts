import { describe, expect, it } from 'vitest';
import { scopedAddressKey } from '../../model/document';
import { LayerEntityRepository } from './LayerEntityRepository';

const address = (kind: 'page' | 'bin', documentId: string, nodeId: string) => ({
  document: { kind, id: documentId } as const, scopePath: [] as string[], nodeId,
});
const idOf = (kind: 'page' | 'bin', documentId: string, nodeId: string) => scopedAddressKey(address(kind, documentId, nodeId));

describe('LayerEntityRepository', () => {
  it('resolves chains and copy-on-write materializes only the edited target', () => {
    const repo = new LayerEntityRepository<{ name: string; pixels: number[] }>();
    repo.createOwned(address('bin', 'asset', 'source'), { name: 'A', pixels: [1] }, 'entity-a');
    repo.createLink(address('page', 'p1', 'target-a'), idOf('bin', 'asset', 'source'));
    repo.createLink(address('page', 'p2', 'target-b'), idOf('page', 'p1', 'target-a'));
    repo.edit(idOf('page', 'p1', 'target-a'), value => { value.name = 'B'; value.pixels.push(2); });
    expect(repo.value(idOf('bin', 'asset', 'source'))).toEqual({ name: 'A', pixels: [1] });
    expect(repo.value(idOf('page', 'p1', 'target-a'))).toEqual({ name: 'B', pixels: [1, 2] });
    expect(repo.value(idOf('page', 'p2', 'target-b'))).toEqual({ name: 'B', pixels: [1, 2] });
  });

  it('forbids page sources inside a bin and materializes targets when a source is deleted', () => {
    const repo = new LayerEntityRepository<{ value: number }>();
    repo.createOwned(address('page', 'p1', 'page-source'), { value: 1 });
    expect(() => repo.createLink(address('bin', 'b1', 'invalid'), idOf('page', 'p1', 'page-source'))).toThrow(/ビン/);
    repo.createOwned(address('bin', 'b1', 'bin-source'), { value: 2 }, 'retained');
    repo.createLink(address('page', 'p1', 'target'), idOf('bin', 'b1', 'bin-source'));
    repo.retainForHistory('retained');
    repo.deleteOccurrence(idOf('bin', 'b1', 'bin-source'));
    expect(repo.value(idOf('page', 'p1', 'target'))).toEqual({ value: 2 });
    expect(repo.entities.get('retained')?.tombstone).toBe(true);
    repo.releaseFromHistory('retained');
    expect(repo.entities.has('retained')).toBe(false);
  });

  it('keeps Canvas structure links while allowing child overrides', () => {
    const repo = new LayerEntityRepository<{ name: string }>();
    const source = repo.createOwned(address('bin', 'b1', 'canvas-source'), { name: 'canvas' });
    const target = repo.createLink(address('page', 'p1', 'canvas-target'), source.id);
    repo.linkCanvasStructure(target.id, source.id);
    const child = repo.createOwned({ ...address('page', 'p1', 'child-b'), scopePath: ['canvas-target'] }, { name: 'B' });
    repo.setCanvasChildOverride(target.id, 'source-child-b', child.id);
    expect(repo.resolveCanvasStructure(target.id)).toBe(source.id);
    expect(repo.canvasStructures.get(target.id)?.childOverrides).toEqual({ 'source-child-b': child.id });
  });

  it('adopts an owned occurrence as a link and keeps the shared entity', () => {
    const repo = new LayerEntityRepository<{ name: string }>();
    const owned = repo.createOwned(address('page', 'p1', 'layer'), { name: 'local' }, 'page-entity');
    const source = repo.createOwned(address('bin', 'b1', 'layer'), { name: 'bin' }, 'bin-entity');
    repo.adoptAsLink(owned.id, source.id);
    expect(repo.value(owned.id)).toEqual({ name: 'bin' });
    repo.writeOwned(source.id, { name: 'updated' });
    expect(repo.value(owned.id)).toEqual({ name: 'updated' });
    repo.edit(owned.id, value => { value.name = 'cow'; });
    expect(repo.value(source.id)).toEqual({ name: 'updated' });
    expect(repo.value(owned.id)).toEqual({ name: 'cow' });
  });
});
