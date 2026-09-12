import { describe, expect, it } from 'vitest';
import type { PaintEngine } from '../PaintEngine';
import type { Layer, ShapeLayer } from '../layers';
import { applyLayerProps } from '../layer-types/registry';
import { ParameterLinkService } from './ParameterLinkService';

function shape(id: string, color: string, x = 0): ShapeLayer {
  return {
    id,
    type: 'shape',
    name: id,
    opacity: 1,
    blend: 'source-over',
    visible: true,
    parentId: null,
    childIds: [],
    state: { snapEnabled: true, shape: { kind: 'rect', x, y: 0, width: 20, height: 10, color, strokeWidth: 2, paintMode: 'stroke' } },
    runtime: undefined,
  };
}

function setup(layers: Layer[]) {
  const history: unknown[] = [];
  const engine = {
    pages: { activePageId: 'p1', pageOrder: ['p1'] },
    layerService: {
      layers,
      assignProps(layer: Layer, props: Record<string, unknown>) {
        applyLayerProps(layer, props);
      },
    },
    getCanvasSpec: () => ({ widthMm: 10, heightMm: 10, ppi: 254 }),
    history: { push: (op: unknown) => history.push(op) },
    committed: () => undefined,
  } as unknown as PaintEngine;
  const service = new ParameterLinkService(engine);
  (engine as unknown as { links: ParameterLinkService }).links = service;
  return { service, history };
}

describe('ParameterLinkService', () => {
  it('propagates an immediate A to B to C chain', () => {
    const a = shape('a', '#111111');
    const b = shape('b', '#222222');
    const c = shape('c', '#333333');
    const { service } = setup([a, b, c]);
    service.createPasteLink('b', { pageId: 'p1', layerId: 'a' });
    service.createPasteLink('c', { pageId: 'p1', layerId: 'b' });
    a.state.shape.color = '#abcdef';
    service.propagateFrom({ pageId: 'p1', layerId: 'a' });
    expect(b.state.shape.color).toBe('#abcdef');
    expect(c.state.shape.color).toBe('#abcdef');
    expect(c.parameterLink?.source.layerId).toBe('b');
  });

  it('detaches only values that actually changed', () => {
    const a = shape('a', '#111111');
    const b = shape('b', '#222222');
    const { service } = setup([a, b]);
    service.createPasteLink('b', { pageId: 'p1', layerId: 'a' });
    const before = structuredClone(b);
    const after = structuredClone(b);
    after.state.shape.color = '#fedcba';
    const change = service.detachChanged(b, before, after)!;
    expect(change.after.linkedParameterIds).not.toContain('appearance.color');
    expect(change.after.linkedParameterIds).toContain('layer.opacity');
    expect(service.detachChanged(b, before, before)).toBeNull();
  });

  it('unlinks one parameter without changing its value or the other links', () => {
    const a = shape('a', '#111111');
    const b = shape('b', '#222222');
    const { service, history } = setup([a, b]);
    service.createPasteLink('b', { pageId: 'p1', layerId: 'a' });
    const color = b.state.shape.color;
    service.unlinkParameter('b', 'appearance.color');
    expect(b.state.shape.color).toBe(color);
    expect(b.parameterLink?.linkedParameterIds).not.toContain('appearance.color');
    expect(b.parameterLink?.linkedParameterIds).toContain('layer.opacity');
    expect(history).toHaveLength(1);
  });

  it('disables self and cyclic source candidates', () => {
    const a = shape('a', '#111111');
    const b = shape('b', '#111111');
    const { service } = setup([a, b]);
    service.createPasteLink('b', { pageId: 'p1', layerId: 'a' });
    const forA = service.candidates('a');
    expect(forA.find(candidate => candidate.address.layerId === 'a')?.disabledReason).toBe('自分自身です');
    expect(forA.find(candidate => candidate.address.layerId === 'b')?.disabledReason).toBe('循環参照になります');
  });
});
