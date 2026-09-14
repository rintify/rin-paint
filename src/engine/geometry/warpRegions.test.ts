import { describe, expect, it } from 'vitest';
import { inverse, scaling, translation, type Homography } from './homography';
import { warpRegions } from './warpRegions';

describe('bounded inverse render requests', () => {
  it('requests the same memory for nearby and distant translations', () => {
    const rect={x:0,y:0,w:600,h:400};
    const near=[...warpRegions(translation(10,20),rect)];
    const far=[...warpRegions(translation(-1e9,1e9),rect)];
    expect(far.map(r=>[r.input.w,r.input.h])).toEqual(near.map(r=>[r.input.w,r.input.h]));
    expect(far.reduce((sum,r)=>sum+r.output.w*r.output.h,0)).toBe(600*400);
    expect(far[0].input.x).toBeGreaterThan(999999990);
  });

  it('never allocates the bounding gap of distant samples under minification', () => {
    const requests=[...warpRegions(scaling(1e-8),{x:0,y:0,w:8,h:8})];
    expect(requests).toHaveLength(64);
    expect(requests.every(r=>r.input.w<=4&&r.input.h<=4)).toBe(true);
    expect(requests.at(-1)!.input.x-requests[0].input.x).toBeGreaterThan(1e8);
  });

  it('splits an inverse horizon without discarding finite samples on either side', () => {
    const inv:Homography=[1,0,0,0,1,0,1,0,-4];
    const requests=[...warpRegions(inverse(inv)!,{x:0,y:0,w:8,h:8})];
    expect(requests.reduce((sum,r)=>sum+r.output.w*r.output.h,0)).toBe(64);
    expect(requests.every(r=>r.input.w<=1024&&r.input.h<=1024)).toBe(true);
    expect(requests.some(r=>r.input.x<0)).toBe(true);
    expect(requests.some(r=>r.input.x>0)).toBe(true);
  });
});
