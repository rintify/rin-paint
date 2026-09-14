import { describe, expect, it } from 'vitest';
import type { LayerMeta } from '../model';
import { commonLayerParameterDescriptors, layerParameterDescriptors, linkableParameterMap, readCanonicalParameter, writeCanonicalParameter } from './layerParameters';

const base = {
  opacity: 1,
  blend: 'source-over' as const,
  visible: true,
  parentId: null,
  childIds: [],
  version: 0,
  canMergeDown: false,
  canRemove: true,
  canTransferShape: false,
};

const rect = {
  kind: 'rect' as const, x: 0, y: 0, width: 10, height: 10, color: '#111111', strokeWidth: 2, paintMode: 'stroke' as const,
};
const textParams = {
  content: 'ab', x: 0, y: 0, width: null, height: null, rotation: 0, direction: 'horizontal' as const,
  horizontalAlign: 'left' as const, verticalAlign: 'top' as const, lineHeight: 1.5,
  style: { fontId: 'sans', color: '#222222', sizeMm: 12 * 25.4 / 72 }, ranges: [] as { start: number; end: number; fontId: string; color: string; sizeMm: number }[], ruby: [] as { start: number; end: number; text: string }[],
};

describe('generic layer parameters', () => {
  it('intersects semantic keys across shape and text layers', () => {
    const shape: LayerMeta = {
      ...base, id: 's', type: 'shape', name: '図形',
      state: { shape: rect, snapEnabled: true },
    };
    const text: LayerMeta = {
      ...base, id: 't', type: 'text', name: '文字',
      state: {
        text: {
          ...textParams,
          ranges: [{ start: 0, end: 1, fontId: 'serif', color: '#333333', sizeMm: 8 * 25.4 / 72 }],
        },
        snapEnabled: true,
      },
    };
    const descriptors = commonLayerParameterDescriptors([shape, text]);
    expect(descriptors.map(value => value.semanticId)).toEqual(expect.arrayContaining([
      'layer.visible', 'layer.opacity', 'layer.blend', 'interaction.snap', 'transform.rotation', 'appearance.color',
      'frame.leftMm', 'frame.topMm', 'frame.widthMm', 'frame.heightMm',
    ]));
    const color = layerParameterDescriptors(text).find(value => value.semanticId === 'appearance.color')!;
    const changed = color.write(text, '#abcdef') as { state: { text: typeof textParams & { ranges: { color: string }[] } } };
    expect(changed.state.text.style.color).toBe('#abcdef');
    expect(changed.state.text.ranges.every(range => range.color === '#abcdef')).toBe(true);
  });

  it('exposes snapEnabled across shape and text object layers', () => {
    const on: LayerMeta = {
      ...base, id: 'a', type: 'shape', name: 'A',
      state: { snapEnabled: true, shape: rect },
    };
    const off: LayerMeta = {
      ...base, id: 'b', type: 'shape', name: 'B',
      state: { snapEnabled: false, shape: { kind: 'line', x1: 0, y1: 0, x2: 4, y2: 4, color: '#111111', strokeWidth: 2 } },
    };
    const mixed = commonLayerParameterDescriptors([on, off]);
    const snap = mixed.find(value => value.semanticId === 'interaction.snap')!;
    expect(snap.control).toBe('switch');
    expect(snap.trueLabel).toBe('ON');
    expect(snap.falseLabel).toBe('OFF');
    expect(snap.read(on)).toBe(true);
    expect(snap.read(off)).toBe(false);
    expect(snap.write(off, true)).toMatchObject({ state: { snapEnabled: true } });
    const text: LayerMeta = {
      ...base, id: 't', type: 'text', name: '文字',
      state: { text: textParams, snapEnabled: true },
    };
    expect(commonLayerParameterDescriptors([on, text]).some(value => value.semanticId === 'interaction.snap')).toBe(true);
  });

  it('exposes native millimeter values without pixel codecs', () => {
    const layer: LayerMeta = {
      ...base, id: 'r', type: 'shape', name: 'R',
      state: { snapEnabled: true, shape: { ...rect, x: 1, y: 2 } },
    };
    const descriptors = commonLayerParameterDescriptors([layer]);
    expect(descriptors.find(value => value.key === 'strokeWidth')?.physicalLength).toBe(true);
    expect(descriptors.find(value => value.key === 'rect.x')?.physicalLength).toBe(true);
    expect(descriptors.find(value => value.key === 'rotation')?.physicalLength).toBeFalsy();
  });

  it('shares physical dimensions without PPI conversion', () => {
    const source: LayerMeta = {
      ...base, id: 's', type: 'shape', name: 'S',
      state: { snapEnabled: true, shape: { kind: 'rect', x: 100, y: 20, width: 200, height: 100, color: '#111111', strokeWidth: 10, paintMode: 'stroke' } },
    };
    const target: LayerMeta = {
      ...base, id: 't', type: 'shape', name: 'T',
      state: { snapEnabled: true, shape: { kind: 'rect', x: 0, y: 0, width: 1, height: 1, color: '#222222', strokeWidth: 1, paintMode: 'stroke' } },
    };
    const sourceDescriptor = linkableParameterMap(source).get('frame.widthMm')!;
    const targetDescriptor = linkableParameterMap(target).get('frame.widthMm')!;
    const widthMm = readCanonicalParameter(sourceDescriptor, source, 254)!;
    expect(widthMm).toBeCloseTo(200);
    const props = writeCanonicalParameter(targetDescriptor, target, widthMm, 127) as { state: { shape: { kind: string; width: number } } };
    expect(props.state.shape.kind === 'rect' && props.state.shape.width).toBeCloseTo(200);
  });
});
