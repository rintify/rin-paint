import { describe, expect, it } from 'vitest';
import type { LayerMeta } from '../model';
import { commonLayerParameterDescriptors } from './layerParameters';

const base = { opacity: 1, blend: 'source-over' as const, visible: true, parentId: null, childIds: [], version: 0, canMergeDown: false, canRemove: true, canTransferShape: false };

describe('generic layer parameters', () => {
  it('intersects semantic keys across shape and text layers', () => {
    const shape: LayerMeta = { ...base, id: 's', type: 'shape', name: '図形', shape: { kind: 'rect', x: 0, y: 0, width: 10, height: 10, color: '#111111', strokeWidth: 2, paintMode: 'stroke' } };
    const text: LayerMeta = { ...base, id: 't', type: 'text', name: '文字', text: { content: 'ab', x: 0, y: 0, width: null, height: null, rotation: 0, direction: 'horizontal', horizontalAlign: 'left', verticalAlign: 'top', lineHeight: 1.5, style: { fontId: 'sans', color: '#222222', sizePt: 12 }, ranges: [{ start: 0, end: 1, fontId: 'serif', color: '#333333', sizePt: 8 }], ruby: [] } };
    const descriptors = commonLayerParameterDescriptors([shape, text]);
    expect(descriptors.map(value => value.key)).toEqual(['visible', 'opacity', 'blend', 'snapEnabled', 'rotation', 'color']);
    const color = descriptors.find(value => value.key === 'color')!;
    const changed = color.write(text, '#abcdef').text!;
    expect(changed.style.color).toBe('#abcdef');
    expect(changed.ranges.every(range => range.color === '#abcdef')).toBe(true);
  });

  it('exposes snapEnabled across shape and text object layers', () => {
    const on: LayerMeta = { ...base, id: 'a', type: 'shape', name: 'A', snapEnabled: true, shape: { kind: 'rect', x: 0, y: 0, width: 10, height: 10, color: '#111111', strokeWidth: 2, paintMode: 'stroke' } };
    const off: LayerMeta = { ...base, id: 'b', type: 'shape', name: 'B', snapEnabled: false, shape: { kind: 'line', x1: 0, y1: 0, x2: 4, y2: 4, color: '#111111', strokeWidth: 2 } };
    const mixed = commonLayerParameterDescriptors([on, off]);
    const snap = mixed.find(value => value.key === 'snapEnabled')!;
    expect(snap.control).toBe('switch');
    expect(snap.trueLabel).toBe('ON');
    expect(snap.falseLabel).toBe('OFF');
    expect(snap.read(on)).toBe(true);
    expect(snap.read(off)).toBe(false);
    expect(snap.write(off, true)).toEqual({ snapEnabled: true });
    const text: LayerMeta = { ...base, id: 't', type: 'text', name: '文字', text: { content: 'ab', x: 0, y: 0, width: null, height: null, rotation: 0, direction: 'horizontal', horizontalAlign: 'left', verticalAlign: 'top', lineHeight: 1.5, style: { fontId: 'sans', color: '#222222', sizePt: 12 }, ranges: [], ruby: [] } };
    expect(commonLayerParameterDescriptors([on, text]).some(value => value.key === 'snapEnabled')).toBe(true);
  });

  it('marks canvas lengths so UI can convert with page ppi', () => {
    const rect: LayerMeta = { ...base, id: 'r', type: 'shape', name: 'R', shape: { kind: 'rect', x: 1, y: 2, width: 10, height: 10, color: '#111111', strokeWidth: 2, paintMode: 'stroke' } };
    const descriptors = commonLayerParameterDescriptors([rect]);
    expect(descriptors.find(value => value.key === 'strokeWidth')?.canvasLength).toBe(true);
    expect(descriptors.find(value => value.key === 'rect.x')?.canvasLength).toBe(true);
    expect(descriptors.find(value => value.key === 'rotation')?.canvasLength).toBeFalsy();
  });
});
