import { createTextLayer } from '../layers';
import { newText } from '../text/model';
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

    state: { snapEnabled: true, shape: { kind: 'rect', x, y: 0, width: 20, height: 10, color, strokeWidth: 2, paintMode: 'stroke' } },
    runtime: undefined,
  };
}

function setup(layers: Layer[]) {
  const history: unknown[] = [];
  const engine = {
    documentKey: {kind: 'page', id: 'p1'},
    bins: {items: []},
    pages: { activePageId: 'p1', pageOrder: ['p1'] },
    layerService: {
      layers,
      bumpLayer() {},
      assignProps(layer: Layer, props: Record<string, unknown>) {
        applyLayerProps(layer, props);
      },
    },
    getPageSpec: () => ({ widthMm: 10, heightMm: 10, ppi: 254 }),
    history: { push: (op: unknown) => history.push(op) },
    committed: () => undefined,
  } as unknown as PaintEngine;
  const service = new ParameterLinkService(engine);
  (engine as unknown as { links: ParameterLinkService }).links = service;
  return { service, history };
}

describe('ParameterLinkService', () => {
  it('shares text content outside the parameter catalog while keeping only edited fields independent', () => {
    const a = createTextLayer('A', {...newText(0, 0, '#ff0000'), content: 'source'}, 'a');
    const b = createTextLayer('B', {...newText(30, 0, '#000000'), content: 'local'}, 'b');
    const {service} = setup([a, b]);
    service.createPasteLink('b', {document: {kind: 'page', id: 'p1'}, layerId: 'a'});
    expect(service.resolveLayer(b).state.text.content).toBe('source');
    a.state.text.content = 'updated';
    expect(service.resolveLayer(b).state.text.content).toBe('updated');
    const before = structuredClone(b);
    b.state.text.content = 'independent';
    const change = service.detachChanged(b, before, b)!;
    expect(change).not.toBeNull();
    b.parameterLink = change.after;
    a.state.text.content = 'upstream'; a.state.text.style.color = '#0000ff';
    service.resolveLayer(b);
    expect(b.state.text.content).toBe('independent');
    expect(b.state.text.style.color).toBe('#0000ff');
    expect(b.parameterLink?.stateOverrides).toEqual({'/text/content': {value: 'independent'}});
  });

  it('resolves A to B to C on read without copying into consumers when the source changes', () => {
    const a = shape('a', '#111111');
    const b = shape('b', '#222222');
    const c = shape('c', '#333333');
    const { service } = setup([a, b, c]);
    service.createPasteLink('b', { document: {kind: 'page' as const, id: 'p1'}, layerId: 'a' });
    service.createPasteLink('c', { document: {kind: 'page' as const, id: 'p1'}, layerId: 'b' });
    a.state.shape.color = '#abcdef';
    service.propagateFrom({ document: {kind: 'page' as const, id: 'p1'}, layerId: 'a' });
    expect(b.state.shape.color).toBe('#222222');
    service.resolveLayer(b);service.resolveLayer(c);
    expect(b.state.shape.color).toBe('#abcdef');
    expect(c.state.shape.color).toBe('#abcdef');
    expect(c.parameterLink?.source.layerId).toBe('b');
  });

  it('detaches only values that actually changed', () => {
    const a = shape('a', '#111111');
    const b = shape('b', '#222222');
    const { service } = setup([a, b]);
    service.createPasteLink('b', { document: {kind: 'page' as const, id: 'p1'}, layerId: 'a' });
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
    service.createPasteLink('b', { document: {kind: 'page' as const, id: 'p1'}, layerId: 'a' });
    const color = service.resolveLayer(b).state.shape.color;
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
    service.createPasteLink('b', { document: {kind: 'page' as const, id: 'p1'}, layerId: 'a' });
    const forA = service.candidates('a');
    expect(forA.find(candidate => candidate.address.layerId === 'a')?.disabledReason).toBe('自分自身です');
    expect(forA.find(candidate => candidate.address.layerId === 'b')?.disabledReason).toBe('循環参照になります');
  });

  it('rejects a cycle through canvas containment, including paste links',()=>{
    const child=shape('child','#111111');
    const canvas:Layer={...shape('canvas','#111111'),type:'canvas',state:{propagateTransforms:true},runtime:undefined,childIds:[child.id]};
    const {service}=setup([canvas,child]);
    expect(service.candidates(child.id).find(candidate=>candidate.address.layerId===canvas.id)?.disabledReason).toBe('循環参照になります');
    service.createPasteLink(child.id,{document: {kind: 'page' as const, id: 'p1'}, layerId:canvas.id});
    expect(child.parameterLink).toBeUndefined();
  });
});
