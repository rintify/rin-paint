// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { PaintEngine } from './PaintEngine';
import { defaultToolSetup, useStore } from '../state/store';
import { CursorTool } from '../tools/cursor/tool';
import { resolveCursorToolSettings } from '../tools/cursor/settings';
import type { ToolKind } from '../tools/registry';
import { createRasterLayer, createShapeLayer } from './layers';

const original = useStore.getState();
afterEach(() => useStore.setState(original, true));

describe('cursor tool activation', () => {
  it('does not treat a missing tool selection as the cursor', () => {
    const setup = defaultToolSetup();
    const cursor = setup.tools.find(tool => tool.kind === 'cursor')!;
    useStore.setState({
      ...original,
      tools: setup.tools,
      toolLayout: setup.toolLayout,
      toolStacks: setup.toolStacks,
      activeToolId: cursor.id,
      tool: 'cursor',
    });
    const engine = new PaintEngine();
    const explicit = engine.activeTool();
    expect(explicit).toBeInstanceOf(CursorTool);
    expect(engine.layerGizmosEnabled()).toBe(false);

    useStore.getState().deactivateTool();
    expect(engine.activeTool()).not.toBe(explicit);
    expect(engine.layerGizmosEnabled()).toBe(true);
    expect(engine.cursor).toBe(explicit);
  });

  it('resolves cursor settings from the explicit tool, then the first visible cursor, then defaults', () => {
    const setup = defaultToolSetup();
    const first = setup.tools.find(tool => tool.kind === 'cursor')!;
    const second = { ...first, id: 'second-cursor' };
    useStore.setState({
      ...original,
      tools: [first, second],
      toolLayout: [
        { type: 'tool', toolId: second.id },
        { type: 'tool', toolId: first.id },
      ],
      toolStacks: [],
      activeToolId: first.id,
      tool: 'cursor' as ToolKind,
    });
    const engine = new PaintEngine();
    expect(engine.firstToolOfKind('cursor')?.id).toBe('second-cursor');
    expect(engine.cursorToolSettings()).toEqual({});

    useStore.getState().deactivateTool();
    expect(engine.cursorToolSettings()).toEqual(
      resolveCursorToolSettings({
        selectedKind: null,
        firstVisibleCursor: engine.firstToolOfKind('cursor'),
      }),
    );
    expect(resolveCursorToolSettings({ selectedKind: null })).toEqual({});
  });
});

describe('palette one-shot auto deselect', () => {
  it('drops a palette-activated cursor after notifyPaletteToolUsed', () => {
    const setup = defaultToolSetup();
    const cursor = setup.tools.find(tool => tool.kind === 'cursor')!;
    useStore.setState({
      ...original,
      tools: setup.tools,
      toolLayout: setup.toolLayout,
      toolStacks: setup.toolStacks,
      activeToolId: null,
      tool: null,
    });
    const engine = new PaintEngine();
    engine.selectToolInstance(cursor.id);
    expect(useStore.getState().tool).toBe('cursor');
    engine.notifyPaletteToolUsed();
    expect(useStore.getState().tool).toBeNull();
    expect(useStore.getState().activeToolId).toBeNull();
  });

  it('keeps the tool when it was activated as a shortcut', () => {
    const setup = defaultToolSetup();
    const cursor = setup.tools.find(tool => tool.kind === 'cursor')!;
    useStore.setState({
      ...original,
      tools: setup.tools,
      toolLayout: setup.toolLayout,
      toolStacks: setup.toolStacks,
      activeToolId: null,
      tool: null,
    });
    const engine = new PaintEngine();
    engine.selectToolInstance(cursor.id, 'shortcut');
    engine.notifyPaletteToolUsed();
    expect(useStore.getState().tool).toBe('cursor');
  });

  it('can be turned off on that tool instance', () => {
    const setup = defaultToolSetup();
    const cursor = setup.tools.find(tool => tool.kind === 'cursor')!;
    useStore.setState({
      ...original,
      tools: setup.tools,
      toolLayout: setup.toolLayout,
      toolStacks: setup.toolStacks,
      activeToolId: null,
      tool: null,
    });
    const engine = new PaintEngine();
    engine.selectToolInstance(cursor.id);
    engine.updateActiveToolSettings({ autoDeactivateAfterUse: false });
    engine.notifyPaletteToolUsed();
    expect(useStore.getState().tool).toBe('cursor');
    expect(useStore.getState().tools.find(tool => tool.id === cursor.id)?.settings).toMatchObject({ autoDeactivateAfterUse: false });
  });
});

describe('layer gizmos and tool compatibility', () => {
  function engineWithLayers() {
    const setup = defaultToolSetup();
    useStore.setState({
      ...original,
      tools: setup.tools,
      toolLayout: setup.toolLayout,
      toolStacks: setup.toolStacks,
      activeToolId: null,
      tool: null,
    });
    const engine = new PaintEngine();
    const raster = createRasterLayer('ラスター', 16, 16, 'raster');
    const shape = createShapeLayer('図形', {
      kind: 'rect',
      x: 1,
      y: 1,
      width: 8,
      height: 8,
      color: '#000',
      strokeWidth: 1,
      paintMode: 'stroke',
      rotation: 0,
    }, 'shape');
    engine.layerService.replaceTree([raster, shape], [raster.id, shape.id], raster.id);
    return { engine, setup, raster, shape };
  }

  it('keeps outline gizmos but blocks handle editing while a tool is selected', () => {
    const { engine, setup } = engineWithLayers();
    const cursor = setup.tools.find(tool => tool.kind === 'cursor')!;
    expect(engine.layerGizmosEnabled()).toBe(true);
    engine.selectToolInstance(cursor.id);
    expect(engine.layerGizmosEnabled()).toBe(false);
    expect(engine.beginShapeEdit({ x: 2, y: 2, pressure: 1 })).toBe(false);
  });

  it('drops a raster-only tool when a shape layer is selected', () => {
    const { engine, setup, shape } = engineWithLayers();
    const pen = setup.tools.find(tool => tool.kind === 'pen')!;
    engine.selectToolInstance(pen.id);
    expect(useStore.getState().tool).toBe('pen');
    engine.setActiveLayer(shape.id);
    expect(useStore.getState().tool).toBeNull();
    expect(useStore.getState().activeToolId).toBeNull();
  });

  it('does not activate a raster-only tool on a shape layer', () => {
    const { engine, setup, shape } = engineWithLayers();
    engine.setActiveLayer(shape.id);
    const pen = setup.tools.find(tool => tool.kind === 'pen')!;
    engine.selectToolInstance(pen.id);
    expect(useStore.getState().tool).toBeNull();
  });

  it('keeps creation tools on a shape layer', () => {
    const { engine, setup, shape } = engineWithLayers();
    engine.setActiveLayer(shape.id);
    const rect = setup.tools.find(tool => tool.kind === 'rect')!;
    engine.selectToolInstance(rect.id);
    expect(useStore.getState().tool).toBe('rect');
  });
});
