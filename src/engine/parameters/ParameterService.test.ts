// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaintEngine } from '../PaintEngine';
import { createShapeLayer } from '../layers';
import { useStore } from '../../state/store';

const original = useStore.getState();
afterEach(() => { useStore.setState(original, true); vi.restoreAllMocks(); });

function setup() {
  const engine = new PaintEngine();
  vi.spyOn(engine, 'requestRender').mockImplementation(() => {});
  vi.spyOn(engine, 'syncStore').mockImplementation(() => {});
  vi.spyOn(engine, 'committed').mockImplementation(() => {});
  const shape = (id: string, color: string) => createShapeLayer(id, {
    kind: 'rect', x: 0, y: 0, width: 20, height: 10,
    color, strokeWidth: 2, paintMode: 'stroke',
  }, id);
  const source = shape('source', '#111111');
  const target = shape('target', '#222222');
  engine.pages.pageOrder = ['p1'];
  engine.pages.activePageId = 'p1';
  engine.layerService.layers = [source, target];
  engine.layerService.rootLayerIds = [source.id, target.id];
  engine.layerService.activeLayerId = target.id;
  useStore.setState({ multiSelectMode: false, selectedLayerIds: [target.id] });
  engine.links.createPasteLink(target.id, { pageId: 'p1', layerId: source.id });
  return { engine, source, target };
}

describe('parameter edit sessions', () => {
  it.each(['#abcdef', '#222222'])('detaches direct edits, including dormant owned values (%s), and restores links on undo', async color => {
    const { engine, source, target } = setup();
    const originalLink = structuredClone(target.parameterLink);
    engine.parameters.commit('appearance.color', color);
    expect(engine.links.effectiveValue(target, 'appearance.color').value).toBe(color);
    expect(target.parameterLink?.linkedParameterIds).not.toContain('appearance.color');
    expect(target.parameterLink?.linkedParameterIds).toContain('layer.opacity');
    await engine.historyService.undo();
    expect(target.state.shape.color).toBe('#222222');
    expect(target.parameterLink).toEqual(originalLink);
    source.state.shape.color = '#fedcba';
    engine.links.propagateFrom({ pageId: 'p1', layerId: source.id });
    expect(engine.links.effectiveValue(target, 'appearance.color').value).toBe('#fedcba');
    await engine.historyService.redo();
    expect(engine.links.effectiveValue(target, 'appearance.color').value).toBe(color);
  });

  it('cancels the original preview targets even after selection changes', () => {
    const { engine, source, target } = setup();
    engine.parameters.preview('appearance.color', '#abcdef');
    expect(engine.hasOpenSession()).toBe(true);
    expect(engine.links.resolvedView(target).state).toMatchObject({ shape: { color: '#abcdef' } });
    engine.layerService.activeLayerId = source.id;
    engine.parameters.cancelPreview();
    expect(engine.hasOpenSession()).toBe(false);
    expect(engine.history.current).toBe(engine.history.root);
    expect(target.state.shape.color).toBe('#222222');
    expect(engine.links.resolvedView(target).state).toMatchObject({ shape: { color: '#111111' } });
  });

  it('commits a preview once and restores each multi-selected owned state on undo', async () => {
    const { engine, source, target } = setup();
    useStore.setState({ multiSelectMode: true, selectedLayerIds: [source.id, target.id] });
    engine.parameters.preview('appearance.color', '#abcdef');
    engine.parameters.commit('appearance.color', '#fedcba');
    expect(engine.history.root.children).toHaveLength(1);
    await engine.historyService.undo();
    expect(source.state.shape.color).toBe('#111111');
    expect(target.state.shape.color).toBe('#222222');
  });

  it('does not edit a read-only project', () => {
    const { engine, target } = setup();
    engine.document.mode = 'view-only';
    engine.parameters.preview('appearance.color', '#abcdef');
    engine.parameters.commit('appearance.color', '#abcdef');
    expect(target.state.shape.color).toBe('#222222');
    expect(engine.history.current).toBe(engine.history.root);
  });
});
