import { describe, expect, it } from 'vitest';
import { fitSizeInBox, fitImageParamsToSource } from '../../model';
import { placedImage } from '../image/frame';
import { resizeByCorner } from '../shapes/kinds/common';

describe('image fit', () => {
  it('scales down to the limiting side without cropping', () => {
    expect(fitSizeInBox(200, 100, 40, 40)).toEqual({ width: 40, height: 20 });
    expect(fitSizeInBox(100, 200, 40, 40)).toEqual({ width: 20, height: 40 });
  });

  it('scales up until the image just fills the box', () => {
    expect(fitSizeInBox(10, 5, 40, 40)).toEqual({ width: 40, height: 20 });
  });

  it('places the fitted size at the given origin', () => {
    expect(placedImage({ width: 800, height: 400 }, 10, 20, 100, 80)).toEqual({
      x: 10, y: 20, width: 100, height: 50, rotation: 0,
    });
  });

  it('fits the current frame to the source aspect without leaving the box', () => {
    expect(fitImageParamsToSource(
      { x: 8, y: 9, width: 200, height: 50, rotation: 0.4 },
      100,
      100,
    )).toEqual({ x: 8, y: 9, width: 50, height: 50, rotation: 0.4 });
  });

  it('keeps aspect when locking a corner resize', () => {
    const size = resizeByCorner('se', { x: 10, y: 10 }, 0, 10, 5, { x: 40, y: 12, pressure: 1 }, true);
    expect(size).not.toBeNull();
    expect(size!.w / size!.h).toBeCloseTo(2);
    expect(size!.cx - size!.w / 2).toBeCloseTo(0);
    expect(size!.cy - size!.h / 2).toBeCloseTo(5);
  });
});
