import { describe, expect, it } from 'vitest';
import { conjugate, corners, fromQuads, inverse, multiply, project, rotation, scaling, transformBounds, translation } from './homography';

describe('physical-coordinate projective transforms', () => {
  it('maps all four corners and keeps straight lines straight', () => {
    const src = corners({ x: -20, y: 5, w: 30, h: 40 });
    const dst = [{x:0,y:0},{x:40,y:5},{x:30,y:50},{x:-4,y:40}];
    const h = fromQuads(src, dst)!;
    src.forEach((p,i) => { expect(project(h,p)!.x).toBeCloseTo(dst[i].x); expect(project(h,p)!.y).toBeCloseTo(dst[i].y); });
    const p = project(h, {x:-5,y:5})!;
    expect(p.x * 5 - p.y * 40).toBeCloseTo(0);
    const restored = project(inverse(h)!, p)!;
    expect(restored.x).toBeCloseTo(-5); expect(restored.y).toBeCloseTo(5);
  });
  it('conjugates a child operator so group transforms apply exactly once', () => {
    const g = multiply(translation(100,-70), scaling(2));
    const t = rotation(.7), p = {x:10,y:20};
    const actual = project(conjugate(t,g), project(g,p)!)!;
    const expected = project(g, project(t,p)!)!;
    expect(actual.x).toBeCloseTo(expected.x); expect(actual.y).toBeCloseTo(expected.y);
  });
  it('rejects crossed handles and reports horizon crossings as unbounded', () => {
    const src = corners({x:0,y:0,w:10,h:10});
    expect(fromQuads(src, [src[0],src[2],src[1],src[3]])).toBeNull();
    expect(transformBounds([1,0,0,0,1,0,1,0,0], {x:-1,y:0,w:2,h:1})).toBeNull();
  });
  it('handles distant coordinates without allocating an enclosing surface', () => {
    const src = corners({x:1e7,y:-1e7,w:10,h:10});
    const dst = corners({x:3,y:4,w:20,h:30});
    const h = fromQuads(src,dst)!;
    expect(project(h,src[2])!.x).toBeCloseTo(23,4);
    expect(project(h,src[2])!.y).toBeCloseTo(34,4);
  });
});
