// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import {describe, expect, it} from 'vitest';
import {openDB} from 'idb';
import {Blob as NodeBlob} from 'node:buffer';
import {RasterTileResource} from '../raster/RasterTileResource';
import {packRasterArchive, unpackRasterArchive} from '../raster/RasterArchive';
import {prepareDocument, putDocument, deleteDocument, readDocument, resourceBytes} from './resourceStorage';

describe('tile resource persistence', () => {
  it('shares unchanged tiles across documents and every history branch, collecting only the last reference', async () => {
    const previous = globalThis.Blob;
    globalThis.Blob = NodeBlob as unknown as typeof Blob;
    try {
      const db=await openDB(`resources-${crypto.randomUUID()}`,1,{upgrade(db){db.createObjectStore('kv');db.createObjectStore('documents',{keyPath:'id'});}});
      const pixels=new Uint8ClampedArray(256*256*4); pixels.set([1,2,3,255]);
      const a=new RasterTileResource('a',pixels); pixels.set([7,8,9,255],4); const b=new RasterTileResource('b',pixels);
      const content=(id:string,tile:RasterTileResource)=>packRasterArchive({ppi:300,origin:{x:0,y:0},tiles:[{key:'-4000,5000',id,blob:tile.blob}]});
      const first={id:'page',current:content('a',a),history:{branches:[content('a',a),content('b',b)]}};
      const second={id:'bin',current:content('a',a)};
      for (const value of [first,second]) {
        const prepared=await prepareDocument(value),tx=db.transaction(['kv','documents'],'readwrite');
        await putDocument(tx,'documents',prepared);await tx.done;
      }
      expect(await resourceBytes(db)).toBe(a.blob.size+b.blob.size);
      const restored=await readDocument(db,await db.get('documents','page')) as typeof first;
      expect((await unpackRasterArchive(restored.current)).tiles[0].key).toBe('-4000,5000');
      expect((await unpackRasterArchive(restored.history.branches[1])).tiles[0].id).toBe('b');
      const remove=db.transaction(['kv','documents'],'readwrite');await deleteDocument(remove,'documents','page');await remove.done;
      expect(await resourceBytes(db)).toBe(a.blob.size);
      const last=db.transaction(['kv','documents'],'readwrite');await deleteDocument(last,'documents','bin');await last.done;
      expect(await resourceBytes(db)).toBe(0); db.close();
    } finally {globalThis.Blob=previous;}
  });
});
