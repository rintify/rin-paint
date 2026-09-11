// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state/store';
import type { LayerMeta } from '../types';
import type { PaintEngine } from '../engine/PaintEngine';
import { EngineProvider } from './EngineContext';
import { LayerPanel, maskCandidateRows } from './LayerPanel';

const actions = vi.hoisted(() => ({ remove: vi.fn(), merge: vi.fn(async () => undefined), rename: vi.fn(() => true) }));
const mockEngine = vi.hoisted(() => ({
  artboard: { w: 1600, h: 1200 },
  getLayerCanvas: () => null,
  setActiveLayer: (id: string) => useStore.getState().set({ activeLayerId: id }),
  canMoveLayer: () => true,
  getShape: () => null,
  removeLayer: actions.remove,
  mergeLayerDown: actions.merge,
  renameLayer: actions.rename,
})) as unknown as PaintEngine;

vi.mock('../engine/shapes', () => ({ drawShape() {} }));

const caps = { canMergeDown: false, canRemove: false, canTransferShape: false };
const base = {
  name: 'ラスター',
  opacity: 1,
  blend: 'source-over' as const,
  visible: true,
  parentId: null,
  childIds: [],
  version: 0,
  ...caps,
};
const layers: LayerMeta[] = [
  { ...base, id: 'raster', type: 'raster', canRemove: false, canMergeDown: false },
  {
    ...base,
    id: 'shape',
    name: '直線',
    type: 'shape',
    canRemove: true,
    canMergeDown: true,
    shape: { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10, strokeWidth: 1, color: '#123456' },
  },
];
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect() {},
    save() {},
    scale() {},
    restore() {},
  } as unknown as CanvasRenderingContext2D);
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: () => ({ cancel() {} }),
  });
  useStore.getState().set({ layers, rootLayerIds: ['raster', 'shape'], activeLayerId: 'raster' });
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    element!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
function menuItem(label: string): Element | null {
  return [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent === label) ?? null;
}
function renderPanel() {
  return act(async () =>
    root.render(
      <EngineProvider engine={mockEngine}>
        <LayerPanel />
      </EngineProvider>,
    ));
}
describe('layer settings entry points', () => {
  it('opens rename from the layer menu and keeps focus until the edited name is committed', async () => {
    actions.rename.mockClear();
    await renderPanel();
    await click(container.querySelector('[aria-label="ラスターのメニュー"]'));
    await click(menuItem('名称変更'));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 300));
    });
    const input = document.querySelector('[role="dialog"] input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('ラスター');
    expect(actions.rename).not.toHaveBeenCalled();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '新しい名称');
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(actions.rename).toHaveBeenCalledWith('raster', '新しい名称');
  });
  it('keeps raster settings hidden until requested, and allows closing with X', async () => {
    await renderPanel();
    expect(container.querySelector('.layer-controls-palette')).toBeNull();
    await click(container.querySelector('[aria-label="ラスターのメニュー"]'));
    expect(menuItem('削除')?.getAttribute('aria-disabled')).toBe('true');
    await click(menuItem('レイヤーの設定'));
    expect(container.querySelector('.layer-controls-palette')).not.toBeNull();
    await click(container.querySelector('[aria-label="レイヤーの設定を閉じる"]'));
    expect(container.querySelector('.layer-controls-palette')).toBeNull();
  });
  it('opens shape settings on selection once, respects closing, and targets the clicked menu', async () => {
    await renderPanel();
    await click([...container.querySelectorAll('.layer-row')].find(el => el.textContent?.includes('直線'))!);
    expect(container.querySelector('.layer-controls-palette')).not.toBeNull();
    await click(container.querySelector('[aria-label="レイヤーの設定を閉じる"]'));
    await act(async () => useStore.getState().set({ layers: [...layers] }));
    expect(container.querySelector('.layer-controls-palette')).toBeNull();
    await act(async () => useStore.getState().set({ activeLayerId: 'raster' }));
    await click(container.querySelector('[aria-label="直線のメニュー"]'));
    await click(menuItem('下と統合'));
    expect(actions.merge).toHaveBeenCalledWith('shape');
    expect(useStore.getState().activeLayerId).toBe('raster');
  });
});

describe('mask candidates', () => {
  it('keeps matching layers in hierarchy order with their ancestors', () => {
    const nested: LayerMeta[] = [
      { ...base, id: 'parent', name: '親', type: 'raster', childIds: ['child'] },
      { ...base, id: 'child', name: '対象文字', type: 'text', parentId: 'parent', text: {} as never },
      {
        ...base,
        id: 'adjust',
        name: '補正',
        type: 'adjust',
        params: { brightness: 100, contrast: 100, hue: 0, saturation: 100 },
        maskLayerIds: [],
      },
    ];
    const result = maskCandidateRows(['parent', 'adjust'], nested, 'adjust', '対象');
    expect(result.map(row => [row.layer.id, row.depth])).toEqual([['parent', 0], ['child', 1]]);
  });
});
