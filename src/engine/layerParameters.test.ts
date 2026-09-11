import { describe, expect, it } from 'vitest';
import type { LayerMeta } from '../model';
import { commonLayerParameterDescriptors } from './layerParameters';

const base = { opacity: 1, blend: 'source-over' as const, visible: true, parentId: null, childIds: [], version: 0, canMergeDown: false, canRemove: true, canTransferShape: false };

describe('generic layer parameters', () => {
  it('intersects semantic keys across shape and text layers', () => {
    const shape: LayerMeta = { ...base, id: 's', type: 'shape', name: '図形', shape: { kind: 'rect', x: 0, y: 0, width: 10, height: 10, color: '#111111', strokeWidth: 2, paintMode: 'stroke' } };
    const text: LayerMeta = { ...base, id: 't', type: 'text', name: '文字', text: { content: 'ab', x: 0, y: 0, width: null, height: null, rotation: 0, direction: 'horizontal', lineHeight: 1.5, style: { fontId: 'sans', color: '#222222', sizePt: 12 }, ranges: [{ start: 0, end: 1, fontId: 'serif', color: '#333333', sizePt: 8 }], ruby: [] } };
    const descriptors = commonLayerParameterDescriptors([shape, text]);
    expect(descriptors.map(value => value.key)).toEqual(['visible', 'opacity', 'blend', 'rotation', 'color']);
    const color = descriptors.find(value => value.key === 'color')!;
    const changed = color.write(text, '#abcdef').text!;
    expect(changed.style.color).toBe('#abcdef');
    expect(changed.ranges.every(range => range.color === '#abcdef')).toBe(true);
  });
});
