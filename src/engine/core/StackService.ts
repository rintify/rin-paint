import type { LayerStack } from '../../model/layerStack';
import { useStore } from '../../state/store';
import type { PaintEngine } from '../PaintEngine';
import type { AtomicOp, Op } from '../history/historyTree';

export class StackService {
  private groups:LayerStack[]=[];
  private committed:LayerStack[]=[];
  constructor(private readonly engine:PaintEngine) {}
  snapshot():LayerStack[] { return structuredClone(this.groups); }
  restore(groups:readonly LayerStack[]):void {
    this.groups=structuredClone([...groups]);this.committed=this.snapshot();
  }
  select(id:string):void {
    const group=this.groups.find(group=>group.id===id);
    if (!group) return;
    this.engine.layerService.selectMembers(group.memberIds);
  }
  deselect(id:string):void {
    const group=this.groups.find(group=>group.id===id);
    if (!group) return;
    const state=useStore.getState();
    const remaining=state.selectedLayerIds.filter(id=>!group.memberIds.includes(id));
    if (remaining.length) this.engine.layerService.selectMembers(remaining);
    else {
      state.set({selectedLayerIds:[],multiSelectMode:true});
      this.engine.scheduleSave();
      this.engine.notifyLayerSelectionChange();
    }
  }
  create():void {
    const engine=this.engine, ls=engine.layerService;
    if (engine.isBusy() || engine.bins.activeId) return;
    ls.finishFloating();
    const state=useStore.getState();
    const selected=new Set(state.selectedLayerIds);
    for(const group of this.groups) if(group.memberIds.some(id=>selected.has(id))) {
      for(const id of group.memberIds) selected.add(id);
    }
    const scope=ls.scopeOf([...selected][0]??'');
    if (scope===undefined || selected.size<2 || [...selected].some(id=>ls.scopeOf(id)!==scope)) return;
    const siblings=ls.siblingIds(scope), members=siblings.filter(id=>selected.has(id));
    const first=siblings.indexOf(members[0]);
    const desired=[...siblings.slice(0,first),...members,...siblings.slice(first).filter(id=>!selected.has(id))];
    const ops:AtomicOp[]=[];
    for(let index=0;index<desired.length;index++) {
      const id=desired[index],from=ls.locationOf(id)!;
      if(from.index===index) continue;
      ls.detachLayer(id);ls.insertAt(id,{parentId:scope,index});
      ops.push({kind:'layerMove',layerId:id,from,to:{parentId:scope,index}});
      ops.push(...engine.canvases.move(id, from, {parentId: scope, index}));
    }
    const before=this.snapshot();
    this.groups=this.groups.filter(group=>!group.memberIds.some(id=>selected.has(id)));
    this.groups.push({id:crypto.randomUUID(),scopeId:scope,memberIds:members});
    ops.push({kind:'layerStacks',before,after:this.snapshot()});
    engine.history.push({kind:'batch',ops},'スタックにまとめる');
    engine.committed();
  }
  dissolve(id:string):void {
    const before=this.snapshot();
    this.groups=this.groups.filter(group=>group.id!==id);
    if (before.length===this.groups.length) return;
    this.engine.history.push({kind:'layerStacks',before,after:this.snapshot()},'スタックを解除');
    this.engine.committed();
  }
  normalize(): void { this.capture({kind: 'batch', ops: []}); }
  /** Called at command commit, so automatic membership changes share the command's Undo. */
  capture(op:Op):Op {
    const ops=op.kind==='batch'?op.ops:[op];
    if (ops.some(op=>op.kind==='layerStacks')) {this.committed=this.snapshot();return op;}
    const ls=this.engine.layerService;
    const moved=new Set(ops.filter(op=>op.kind==='layerMove').map(op=>op.layerId));
    for(const group of this.groups) {
      const siblings=ls.siblingIds(group.scopeId);
      group.memberIds=group.memberIds.filter(id=>siblings.includes(id));
      for(const id of moved) {
        if(!group.memberIds.includes(id)) continue;
        const other=group.memberIds.filter(member=>member!==id).map(member=>siblings.indexOf(member));
        const index=siblings.indexOf(id);
        if(other.length && (index<Math.min(...other)-1 || index>Math.max(...other)+1)) group.memberIds=group.memberIds.filter(member=>member!==id);
      }
      if(group.memberIds.length>=2) {
        const indices=group.memberIds.map(id=>siblings.indexOf(id));
        group.memberIds=siblings.slice(Math.min(...indices),Math.max(...indices)+1);
      }
    }
    this.groups=this.groups.filter(group=>group.memberIds.length>=2);
    const after=this.snapshot(),before=this.committed;
    this.committed=structuredClone(after);
    if(JSON.stringify(before)===JSON.stringify(after)) return op;
    return {kind:'batch',ops:[...ops,{kind:'layerStacks',before,after}]};
  }
}
