import { describe, expect, it } from 'vitest';
import * as clipping from 'polygon-clipping';
import type { ShapePoint } from '../../model';
import { polygonArea } from '../shapes';
import { clipPolygonByBand } from './PolygonSplitService';

const rect: ShapePoint[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const area = (parts: ShapePoint[][]) => parts.reduce((sum, part) => sum + Math.abs(polygonArea(part)), 0);

describe('polygon band clipping', () => {
  it('splits on a zero-width infinite line without removing area', () => {
    const parts = clipPolygonByBand(clipping, rect, { x: 5, y: -1 }, { x: 5, y: 1 }, 0, 20);
    expect(parts).toHaveLength(2);
    expect(area(parts)).toBeCloseTo(100);
  });

  it('removes a centered band and can erase the whole polygon', () => {
    const cut = clipPolygonByBand(clipping, rect, { x: 5, y: -1 }, { x: 5, y: 1 }, 4, 20);
    expect(cut).toHaveLength(2);
    expect(area(cut)).toBeCloseTo(60);
    expect(clipPolygonByBand(clipping, rect, { x: 5, y: -1 }, { x: 5, y: 1 }, 20, 20)).toHaveLength(0);
  });

  it('keeps every connected fragment of a concave polygon', () => {
    const concave: ShapePoint[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 3 }, { x: 3, y: 3 },
      { x: 3, y: 7 }, { x: 10, y: 7 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const parts = clipPolygonByBand(clipping, concave, { x: 5, y: -1 }, { x: 5, y: 1 }, 0, 20);
    expect(parts).toHaveLength(3);
    expect(area(parts)).toBeCloseTo(72);
  });
});
