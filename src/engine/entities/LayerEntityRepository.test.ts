import { describe, expect, it } from 'vitest';
import { LayerEntityRepository } from './LayerEntityRepository';

const address = (kind: 'page' | 'bin', documentId: string, nodeId: string) => ({
  document: { kind, id: documentId }, scopePath: [], nodeId,
});

describe('LayerEntityRepository', () => {
  it('resolves chains and copy-on-write materializes only the edited target', () => {
    const repo = new LayerEntityRepository<{ name: string; pixels: number[] }>();
    repo.createOwned(address('bin', 'asset', 'source'), { name: 'A', pixels: [1] }, 'entity-a');
    repo.createLink(address('page', 'p1', 'target-a'), 'source');
    repo.createLink(address('page', 'p2', 'target-b'), 'target-a');
    repo.edit('target-a', value => { value.name = 'B'; value.pixels.push(2); });
    expect(repo.value('source')).toEqual({ name: 'A', pixels: [1] });
    expect(repo.value('target-a')).toEqual({ name: 'B', pixels: [1, 2] });
    expect(repo.value('target-b')).toEqual({ name: 'B', pixels: [1, 2] });
  });

  it('forbids page sources inside a bin and materializes targets when a source is deleted', () => {
    const repo = new LayerEntityRepository<{ value: number }>();
    repo.createOwned(address('page', 'p1', 'page-source'), { value: 1 });
    expect(() => repo.createLink(address('bin', 'b1', 'invalid'), 'page-source')).toThrow(/ビン/);
    repo.createOwned(address('bin', 'b1', 'bin-source'), { value: 2 }, 'retained');
    repo.createLink(address('page', 'p1', 'target'), 'bin-source');
    repo.retainForHistory('retained');
    repo.deleteOccurrence('bin-source');
    expect(repo.value('target')).toEqual({ value: 2 });
    expect(repo.entities.get('retained')?.tombstone).toBe(true);
    repo.releaseFromHistory('retained');
    expect(repo.entities.has('retained')).toBe(false);
  });

  it('keeps Canvas structure links while allowing child overrides', () => {
    const repo = new LayerEntityRepository<{ name: string }>();
    repo.createOwned(address('bin', 'b1', 'canvas-source'), { name: 'canvas' });
    repo.createLink(address('page', 'p1', 'canvas-target'), 'canvas-source');
    repo.linkCanvasStructure('canvas-target', 'canvas-source');
    repo.createOwned({ ...address('page', 'p1', 'child-b'), scopePath: ['canvas-target'] }, { name: 'B' });
    repo.setCanvasChildOverride('canvas-target', 'source-child-b', 'child-b');
    expect(repo.resolveCanvasStructure('canvas-target')).toBe('canvas-source');
    expect(repo.canvasStructures.get('canvas-target')?.childOverrides).toEqual({ 'source-child-b': 'child-b' });
  });
});
