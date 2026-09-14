/** Page presentation metadata. A stack never participates in compositing. */
export interface LayerStack {
  id: string;
  scopeId: string | null;
  memberIds: string[];
}

export function isLayerStacks(value:unknown):value is LayerStack[] {
  if (!Array.isArray(value)) return false;
  const ids=new Set<string>(),members=new Set<string>();
  return value.every(stack=>{
    if (!stack || typeof stack.id !== 'string' || ids.has(stack.id)
      || !(stack.scopeId===null || typeof stack.scopeId==='string')
      || !Array.isArray(stack.memberIds) || stack.memberIds.length<2) return false;
    ids.add(stack.id);
    return stack.memberIds.every((id:unknown)=>{
      if (typeof id!=='string' || members.has(id)) return false;
      members.add(id);return true;
    });
  });
}

export function stacksMatchScopes(
  stacks: readonly LayerStack[],
  roots: readonly string[],
  layers: readonly {id: string; type: string; parentId: string | null; childIds: readonly string[]}[],
): boolean {
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  return stacks.every(stack => {
    const canvas = stack.scopeId === null ? null : byId.get(stack.scopeId);
    if (stack.scopeId !== null && canvas?.type !== 'canvas') return false;
    const siblings = canvas ? canvas.childIds : roots;
    const first = siblings.indexOf(stack.memberIds[0]);
    return first >= 0 && stack.memberIds.every((id, offset) =>
      siblings[first + offset] === id && byId.get(id)?.parentId === stack.scopeId);
  });
}
