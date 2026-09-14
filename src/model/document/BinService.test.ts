import { describe, expect, it } from 'vitest';
import { BinService } from './BinService';
import { CommandService } from './CommandService';
import { DocumentSession } from './DocumentSession';
import { overrideField } from './LinkResolver';
import { ProjectRepository } from './ProjectRepository';
import type { LayerDocument, LayerEntity } from './types';

describe('bin ownership and document history', () => {
  it('keeps registration and subsequent bin edits when page binding changes are undone and redone', () => {
    const key = {kind:'page' as const,id:'page'};
    const doc: LayerDocument = {key,root:{id:'root',children:[{id:'occurrence',entityId:'raster'}]},entities:{
      raster:{id:'raster',type:'raster',binding:{source:null,linkedFields:[],localValues:{color:'red',content:'tiles', 'mask.sources':['external']}}},
    }};
    const repo = new ProjectRepository(); repo.replace([doc]);
    const commands = new CommandService(repo), bin = new BinService(repo,commands);
    const source = bin.register({document:key,entityId:'raster'});
    expect(repo.links.field(source,'mask.sources')).toEqual([]);
    commands.execute(source.document,'色を変更',draft => overrideField(draft.entities[source.entityId],'color','blue'));
    expect(repo.links.field({document:key,entityId:'raster'},'color')).toBe('blue');
    expect(repo.links.field({document:key,entityId:'raster'},'mask.sources')).toEqual(['external']);
    commands.undo(key);
    expect(repo.links.field({document:key,entityId:'raster'},'color')).toBe('red');
    expect(repo.links.field(source,'color')).toBe('blue');
    commands.redo(key);
    expect(repo.links.field({document:key,entityId:'raster'},'color')).toBe('blue');
    const binHistory = commands.history(source.document);
    bin.addReference(source,key,'root',99);
    expect(repo.document(key)?.root.children).toHaveLength(2);
    expect(commands.history(source.document)).toEqual(binHistory);
    commands.undo(key);
    expect(repo.document(key)?.root.children).toHaveLength(1);
    expect(repo.get(source)).toBeDefined();
  });

  it('restores page selection and view after editing a bin item', () => {
    const session = new DocumentSession();
    const page = {kind:'page' as const,id:'p'}, bin = {kind:'bin-item' as const,id:'b'};
    const view = {scopeId:'root',selectedIds:['a'],zoom:2,pan:{x:10,y:20},workRectMm:{w:210,h:297}};
    session.open(page,view); session.select('inner',['child']);
    session.open(bin,{...view,selectedIds:['asset']});
    session.updateView({zoom:4});
    expect(session.returnToPage()).toBe(true);
    const restored = new DocumentSession(); restored.restore(session.snapshot());
    expect(restored.snapshot().target?.scope.scopeId).toBe('inner');
    expect(Object.values(restored.snapshot().views).map(value => value.zoom)).toEqual([2,4]);
  });

  it('registers nested overridden structure, including local children and removed inherited children', () => {
    const key={kind:'page' as const,id:'p'};
    const binding=()=>({source:null,linkedFields:[],localValues:{}});
    const canvas=(id:string,children:string[],source?:string): LayerEntity & {type:'canvas'} => ({
      id,type:'canvas',binding:binding(),structure:{source:source?{document:key,entityId:source}:null,
        local:{id:`scope-${id}`,children:children.map(entityId=>({id:`o-${entityId}`,entityId}))},
        suppressed:[],placements:[],overrides:{}},
    });
    const original=canvas('original',['inner']);
    const inner=canvas('inner',['removed']);
    const variant=canvas('variant',[],'original');
    const changed=canvas('changed',['added'],'inner');
    changed.structure.suppressed=['o-removed'];
    variant.structure.overrides['o-inner']=changed;
    const entities: LayerEntity[]=[original,inner,variant,
      ...['removed','added'].map(id=>({id,type:'raster' as const,binding:binding()}))];
    const repo=new ProjectRepository();
    repo.replace([{key,root:{id:'root',children:[{id:'o-original',entityId:'original'},{id:'o-variant',entityId:'variant'}]},
      entities:Object.fromEntries(entities.map(entity=>[entity.id,entity]))}]);
    const commands=new CommandService(repo);
    const bin=new BinService(repo,commands).register({document:key,entityId:'variant'});
    const binChild=repo.scopes.children(bin)[0];
    expect(repo.scopes.childrenOf(binChild).map(child=>child.id)).toEqual(['o-added']);
    expect(JSON.stringify(repo.document(bin.document))).not.toContain('"kind":"page"');
    commands.undo(key);
    expect(repo.scopes.childrenOf(repo.scopes.children({document:key,entityId:'variant'})[0]).map(child=>child.id)).toEqual(['o-added']);
    commands.redo(key);
    expect(repo.scopes.childrenOf(repo.scopes.children({document:key,entityId:'variant'})[0]).map(child=>child.id)).toEqual(['o-added']);
  });
});
