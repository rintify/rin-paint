import type {IDBPDatabase, IDBPTransaction} from 'idb';
import {packResources, unpackResources, type PackedResources} from './resourceGraph';

export interface ResourceDocument {id: string; resourceIds: string[]; value: unknown}
export interface PreparedDocument extends PackedResources {id:string}
const prefix = 'resource:';
interface Resource {blob:Blob; users:number}
export async function prepareDocument(value: {id:string}): Promise<PreparedDocument> {
  return {id:value.id,...await packResources(value)};
}

/** Document and history are one graph. Counts change in the same transaction as that graph. */
export async function putDocument(tx: IDBPTransaction<unknown,string[],'readwrite'>, store: string, prepared: PreparedDocument): Promise<void> {
  const documents = tx.objectStore(store), kv=tx.objectStore('kv');
  const before = await documents.get(prepared.id) as ResourceDocument | undefined;
  const oldIds=new Set(before?.resourceIds ?? []), newIds=new Set(prepared.resources.keys());
  for (const id of newIds) {
    if (oldIds.has(id)) continue;
    const previous = await kv.get(prefix+id) as Resource | undefined;
    await kv.put({blob:previous?.blob ?? prepared.resources.get(id)!,users:(previous?.users ?? 0)+1},prefix+id);
  }
  for (const id of oldIds) {
    if (newIds.has(id)) continue;
    const previous = await kv.get(prefix+id) as Resource | undefined;
    if (!previous || previous.users <= 1) await kv.delete(prefix+id);
    else await kv.put({...previous,users:previous.users-1},prefix+id);
  }
  const document={id:prepared.id,resourceIds:[...newIds],value:prepared.value} satisfies ResourceDocument;
  if (store === 'kv') await documents.put(document,prepared.id); else await documents.put(document);
}
export async function deleteDocument(tx: IDBPTransaction<unknown,string[],'readwrite'>, store:string, id:string): Promise<void> {
  await putDocument(tx,store,{id,value:null,resources:new Map()});
  await tx.objectStore(store).delete(id);
}
export async function readDocument(db: IDBPDatabase, stored: unknown): Promise<unknown> {
  if (!stored || typeof stored !== 'object' || !('resourceIds' in stored)) return stored;
  return unpackResources((stored as ResourceDocument).value,async id => (await db.get('kv',prefix+id) as Resource | undefined)?.blob);
}
export async function resourceBytes(db: IDBPDatabase): Promise<number> {
  const resources = await db.getAll('kv',IDBKeyRange.bound(prefix,prefix+'\uffff')) as Resource[];
  return resources.reduce((total,resource)=>total+resource.blob.size,0);
}
export async function clearResources(tx: IDBPTransaction<unknown,string[],'readwrite'>): Promise<void> {
  await tx.objectStore('kv').delete(IDBKeyRange.bound(prefix,prefix+'\uffff'));
}
