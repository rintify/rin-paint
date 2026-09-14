import { describe, expect, it } from 'vitest';
import { CommandService } from './CommandService';
import { ProjectRepository } from './ProjectRepository';
import { overrideField, relinkField } from './LinkResolver';
import type { LayerDocument, LayerEntity, LayerSourceAddress } from './types';

const page = {kind:'page' as const, id:'p'};
const address = (entityId: string): LayerSourceAddress => ({document:page, entityId});
function layer(id: string, source: string | null = null): LayerEntity {
  return {id, type:'raster', binding:{source:source ? address(source) : null,
    linkedFields:source ? ['x','color','content'] : [], localValues:{x:1,color:'red',content:'tiles-1'}}};
}
function canvas(id: string, children: string[], source: string | null = null): LayerEntity & {type:'canvas'} {
  return {id,type:'canvas',binding:{source:null,linkedFields:[],localValues:{}},structure:{
    source:source ? address(source) : null, local:{id:`scope-${id}`, children:children.map(entityId => ({id:`o-${entityId}`,entityId}))},
    suppressed:[],placements:[],overrides:{},
  }};
}
function repository(entities: LayerEntity[], roots: string[]): ProjectRepository {
  const repo = new ProjectRepository();
  const doc: LayerDocument = {key:page, root:{id:'root',children:roots.map(entityId => ({id:`o-${entityId}`,entityId}))},entities:Object.fromEntries(entities.map(entity => [entity.id,entity]))};
  repo.replace([doc]); return repo;
}

describe('shared fields and canvas structure overlays', () => {
  it('resolves chains immediately without overwriting independent fields; relink discards local content', () => {
    const repo = repository([layer('source'),layer('target','source'),layer('downstream','target')], ['source','target','downstream']);
    const target = repo.get(address('target'))!;
    overrideField(target,'x',30);
    overrideField(repo.get(address('source'))!,'color','blue');
    expect(repo.links.field(address('downstream'),'x')).toBe(30);
    expect(repo.links.field(address('target'),'color')).toBe('blue');
    overrideField(target,'content','local-tiles');
    expect(repo.links.field(address('downstream'),'content')).toBe('local-tiles');
    relinkField(target,'content');
    expect(repo.links.field(address('downstream'),'content')).toBe('tiles-1');
  });

  it('merges source ordering, suppression, and sequential insertion overrides with stable IDs', () => {
    const source = canvas('source',['a','b','c']);
    const target = canvas('target',['local'],'source');
    target.structure.suppressed = ['o-b'];
    target.structure.placements = [{occurrenceId:'o-local',index:1},{occurrenceId:'o-c',index:0}];
    const repo = repository([source,target,...['a','b','c','local'].map(id => layer(id))],['source','target']);
    expect(repo.scopes.children(address('target')).map(child => child.id)).toEqual(['o-c','o-a','o-local']);
    const live = repo.get(address('source'))!;
    if (live.type !== 'canvas') throw new Error();
    live.structure.local.children.reverse();
    expect(repo.scopes.children(address('target')).map(child => child.id)).toEqual(['o-c','o-local','o-a']);
    expect(Object.keys(target.structure.overrides)).toHaveLength(0);
  });

  it('rejects reference chains and containment cycles atomically', () => {
    expect(() => repository([layer('a','b'),layer('b','a')],['a','b'])).toThrow('循環');
    expect(() => repository([canvas('outer',['child']),layer('child','outer')],['outer'])).toThrow('循環');
    const repo = repository([layer('a')],['a']);
    const before = repo.snapshot();
    const bad = structuredClone(before); bad[0].entities.a.binding.source = address('a');
    expect(() => repo.replace(bad)).toThrow('循環');
    expect(repo.snapshot()).toEqual(before);
  });

  it('allows page-to-bin references and denies bin-to-page access', () => {
    const repo = repository([layer('a')],['a']);
    const bin: LayerDocument = {key:{kind:'bin-item',id:'asset'},root:{id:'root',children:[{id:'asset',entityId:'asset'}]},entities:{asset:layer('asset')}};
    repo.replace([...repo.snapshot(),bin]);
    expect(() => repo.links.assertLink(address('a'),{document:bin.key,entityId:'asset'})).not.toThrow();
    expect(() => repo.links.assertLink({document:bin.key,entityId:'asset'},address('a'))).toThrow('ビン');
    expect(() => repo.binReader().get(address('a'))).toThrow('ビン');
  });

  it('resolves nested inline canvas changes in the overriding document', () => {
    const source = canvas('source',['inner']);
    const inner = canvas('inner',['a']);
    const target = canvas('target',[],'source');
    const override = canvas('inner-override',['extra'],'inner');
    override.structure.suppressed = ['o-a'];
    target.structure.overrides['o-inner'] = override;
    const repo = repository([source,inner,target,layer('a'),layer('extra')],['source','target']);
    const resolved = repo.scopes.children(address('target'))[0];
    expect(repo.scopes.childrenOf(resolved).map(child => child.id)).toEqual(['o-extra']);
    const bad = repo.snapshot();
    const edited = bad[0].entities.target;
    if (edited.type !== 'canvas') throw new Error();
    const nested = edited.structure.overrides['o-inner'];
    if (nested.type !== 'canvas') throw new Error();
    nested.structure.local.children.push({id:'cycle',entityId:'target'});
    expect(() => repo.replace(bad)).toThrow('循環');
  });
  it('materializes a deleted source at its latest value without breaking a downstream chain', () => {
    const repo = repository([layer('source'), layer('target', 'source'), layer('next', 'target')], ['source', 'target', 'next']);
    overrideField(repo.get(address('source'))!, 'color', 'blue');
    overrideField(repo.get(address('target'))!, 'x', 30);
    const draft = repo.snapshot();
    delete draft[0].entities.source;
    draft[0].root.children.shift();
    repo.replace(draft);
    expect(repo.get(address('target'))!.binding.source).toBeNull();
    expect(repo.links.field(address('next'), 'color')).toBe('blue');
    expect(repo.links.field(address('next'), 'x')).toBe(30);
  });

  it('retains an edited child when the source removes it and drops an untouched child', () => {
    const source = canvas('source', ['a', 'b']);
    const target = canvas('target', [], 'source');
    const edited = layer('override', 'a');
    overrideField(edited, 'color', 'green');
    target.structure.overrides['o-a'] = edited;
    const repo = repository([source, target, layer('a'), layer('b')], ['source', 'target']);
    const draft = repo.snapshot();
    const sourceDraft = draft[0].entities.source;
    if (sourceDraft.type !== 'canvas') throw new Error();
    sourceDraft.structure.local.children = [];
    delete draft[0].entities.a;
    delete draft[0].entities.b;
    repo.replace(draft);
    const children = repo.scopes.children(address('target'));
    expect(children.map(child => child.id)).toEqual(['o-a']);
    expect(children[0].entity.binding.source).toBeNull();
    expect(children[0].entity.binding.localValues.color).toBe('green');
  });

  it('preserves edited grandchildren and two independent canvas consumers when a source disappears', () => {
    const source = canvas('source', ['inner']);
    const inner = canvas('inner', ['leaf']);
    const first = canvas('first', [], 'source');
    const second = canvas('second', [], 'source');
    const editedInner = canvas('inner-override', [], 'inner');
    const editedLeaf = layer('leaf-override', 'leaf');
    overrideField(editedLeaf, 'color', 'green');
    editedInner.structure.overrides['o-leaf'] = editedLeaf;
    first.structure.overrides['o-inner'] = editedInner;
    const repo = repository([source, inner, first, second, layer('leaf')], ['source', 'first', 'second']);
    const draft = repo.snapshot();
    draft[0].root.children.shift();
    for (const id of ['source', 'inner', 'leaf']) delete draft[0].entities[id];
    repo.replace(draft);
    const firstInner = repo.scopes.children(address('first'))[0];
    const secondInner = repo.scopes.children(address('second'))[0];
    expect(repo.scopes.childrenOf(firstInner)[0].entity.binding.localValues.color).toBe('green');
    expect(repo.scopes.childrenOf(secondInner)[0].entity.binding.localValues.color).toBe('red');
    expect(firstInner.entity.id).not.toBe(secondInner.entity.id);
  });

  it('source deletion Undo relinks untouched consumers without overwriting edited consumers', () => {
    const sourcePage = {kind: 'page' as const, id: 'source-page'};
    const sourceAddress = {document: sourcePage, entityId: 'source'};
    const target = layer('target');
    target.binding.source = sourceAddress;
    target.binding.linkedFields = ['x', 'color', 'content'];
    const edited = structuredClone(target); edited.id = 'edited';
    const repo = new ProjectRepository();
    repo.replace([
      {key: sourcePage, root: {id: 'root', children: [{id: 'source', entityId: 'source'}]}, entities: {source: layer('source')}},
      {key: page, root: {id: 'root', children: [{id: 'target', entityId: 'target'}, {id: 'edited', entityId: 'edited'}]}, entities: {target, edited}},
    ]);
    const commands = new CommandService(repo);
    commands.execute(sourcePage, '削除', draft => {draft.root.children = []; delete draft.entities.source;});
    expect(repo.get(address('target'))!.binding.source).toBeNull();
    commands.execute(page, '独立後に編集', draft => overrideField(draft.entities.edited, 'color', 'green'));
    commands.undo(sourcePage);
    expect(repo.get(address('target'))!.binding.source).toEqual(sourceAddress);
    expect(repo.get(address('edited'))!.binding.source).toBeNull();
    expect(repo.links.field(address('edited'), 'color')).toBe('green');
  });

});
