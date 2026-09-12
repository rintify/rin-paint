// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { PaintEngine } from './PaintEngine';
import { defaultToolSetup, useStore } from '../state/store';
import { CursorTool } from '../tools/cursor/tool';
import { resolveCursorToolSettings } from '../tools/cursor/settings';
import type { ToolKind } from '../tools/registry';

const original = useStore.getState();
afterEach(() => useStore.setState(original, true));

describe('cursor tool activation', () => {
  it('uses the same cursor instance for an explicit tool and a missing selection', () => {
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
    expect(explicit.allowsDirectShapeEdit).toBe(false);

    useStore.getState().deactivateTool();
    const implicit = engine.activeTool();
    expect(implicit).toBe(explicit);
    expect(implicit.allowsDirectShapeEdit).toBe(false);
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
