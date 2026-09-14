import { describe, expect, it } from 'vitest';
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
});
