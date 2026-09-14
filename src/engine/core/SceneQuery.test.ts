import { describe, expect, it } from 'vitest';
import { SceneQuery, type ScopedLayer } from './SceneQuery';

describe('scene reference scope', () => {
  const layers: ScopedLayer[] = [
    {id:'canvas',type:'canvas',parentId:null,childIds:['inner'],visible:true},
    {id:'inner',type:'raster',parentId:'canvas',childIds:[],visible:true},
    {id:'mask',type:'raster',parentId:null,childIds:[],visible:false},
    {id:'effect',type:'adjust',parentId:null,childIds:[],visible:true},
    {id:'later',type:'raster',parentId:null,childIds:[],visible:true},
  ];
  it('exposes a canvas as one object and distinguishes invalid reference reasons', () => {
    const query = new SceneQuery(['canvas','mask','effect','later'],layers);
    expect(query.members(null).map(layer => layer.id)).toEqual(['canvas','mask','effect','later']);
    expect(query.members('canvas').map(layer => layer.id)).toEqual(['inner']);
    expect(query.masks('effect',['canvas','mask','inner','later','deleted'])).toEqual({
      valid:['canvas','mask'],invalid:[
        {sourceId:'inner',problem:'different-scope'},
        {sourceId:'later',problem:'not-below'},
        {sourceId:'deleted',problem:'missing'},
      ],
    });
  });
  it('revalidates authored masks when order is restored without changing their IDs', () => {
    const ids = ['mask'];
    expect(new SceneQuery(['effect','mask'],layers).masks('effect',ids).valid).toEqual([]);
    expect(new SceneQuery(['mask','effect'],layers).masks('effect',ids).valid).toEqual(ids);
  });
});
