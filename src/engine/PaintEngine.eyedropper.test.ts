import { afterEach, describe, expect, it } from 'vitest';
import { PaintEngine } from './PaintEngine';
import { defaultToolSetup, useStore } from '../state/store';

const original = useStore.getState();
afterEach(() => useStore.setState(original, true));

describe('PaintEngine long-press eyedropper selection', () => {
  it('uses the first eyedropper in visible tool order', () => {
    const setup = defaultToolSetup();
    const first = setup.tools.find((tool) => tool.kind === 'eyedropper')!;
    const second = {
      ...first,
      id: 'second-eyedropper',
      settings: { source: 'final-color' },
    };
    useStore.setState({
      ...original,
      tools: [first, second],
      toolLayout: [
        { type: 'tool', toolId: second.id },
        { type: 'tool', toolId: first.id },
      ],
      toolStacks: [],
    });
    const engine = Object.create(PaintEngine.prototype) as PaintEngine;

    expect(engine.longPressEyedropperSource()).toBe('final-color');
  });
});
