import {describe,expect,it} from 'vitest';
import {finiteProjection} from './finiteProjection';
import {translation,type Homography} from './homography';
describe('finite input footprints',()=>{
  it('keeps both finite sides of a horizon without allocating its infinite bounds',()=>{
    const matrix:Homography=[1,0,0,0,1,0,1,0,-4];
    const regions=[...finiteProjection(matrix,{x:0,y:0,w:8,h:8})];
    expect(regions.length).toBeGreaterThan(1);
    expect(regions.some(region=>region.x<0)).toBe(true);
    expect(regions.some(region=>region.x>0)).toBe(true);
    expect(regions.every(region=>region.w<=4096&&region.h<=4096)).toBe(true);
  });
  it('does not clip a distant finite affine footprint to the page',()=>{
    expect([...finiteProjection(translation(-1e9,1e9),{x:0,y:0,w:20,h:10})]).toEqual([{x:-1e9,y:1e9,w:20,h:10}]);
  });
});
