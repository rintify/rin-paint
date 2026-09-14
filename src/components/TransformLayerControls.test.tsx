// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TransformLayerControls } from './TransformLayerControls';
import { EngineProvider } from './EngineContext';
import { useStore } from '../state/store';
import { DEFAULT_TRANSFORM } from '../model/transform';
import { defaultLayerCommon, type LayerMeta } from '../model';
import type { PaintEngine } from '../engine/PaintEngine';

it('shows transform controls with no source selection or content prerequisite', async () => {
  const original = useStore.getState();
  const mode = vi.fn(),
    reset = vi.fn();
  const engine = {
    transformEdit: { mode: 'perspective', setMode: mode, reset },
  } as unknown as PaintEngine;
  useStore.setState({
    multiSelectMode: false,
    activeLayerId: 'transform',
    layers: [
      {
        ...defaultLayerCommon('transform', '変形'),
        type: 'transform',
        state: { ...DEFAULT_TRANSFORM },
        version: 0,
        canMergeDown: true,
        canRemove: true,
        canTransferShape: false,
      } as LayerMeta,
    ],
  });
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () =>
      root.render(
        <EngineProvider engine={engine}>
          <TransformLayerControls />
        </EngineProvider>,
      ),
    );
    expect(element.textContent).toContain('枠の内側をドラッグで移動');
    const buttons = [...element.querySelectorAll('button')];
    await act(async () =>
      buttons.find((button) => button.textContent === '自由変形')!.click(),
    );
    expect(mode).toHaveBeenCalledWith('perspective');
    expect(element.textContent).toContain('角の□を1つずつ動かす');
    await act(async () =>
      buttons.find((button) => button.textContent === 'リセット')!.click(),
    );
    expect(reset).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    element.remove();
    useStore.setState(original, true);
  }
});
