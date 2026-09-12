// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state/store';
import type { LayerMeta } from '../types';
import type { PaintEngine } from '../engine/PaintEngine';
import { EngineProvider } from './EngineContext';
import { LayerPanel, maskCandidateRows } from './LayerPanel';

const actions = vi.hoisted(() => ({
  remove: vi.fn(),
  merge: vi.fn(async () => undefined),
  rename: vi.fn(() => true),
  addRaster: vi.fn(),
  addAdjust: vi.fn(),
  addOutline: vi.fn(),
  addClip: vi.fn(),
  setActiveLayer: vi.fn((id: string) => useStore.getState().set({ activeLayerId: id })),
  beginMultiSelect: vi.fn((id: string) => {
    const state = useStore.getState();
    const previous = state.selectedLayerIds.length ? state.selectedLayerIds : [state.activeLayerId];
    const selected = [...previous, ...(!previous.includes(id) ? [id] : [])];
    state.set({ multiSelectMode: true, selectedLayerIds: selected, activeLayerId: selected[0] });
  }),
}));
const mockEngine = vi.hoisted(() => ({
  artboard: { w: 1600, h: 1200 },
  getLayerCanvas: () => null,
  setActiveLayer: actions.setActiveLayer,
  beginMultiSelect: actions.beginMultiSelect,
  canMoveLayer: () => true,
  getShape: () => null,
  removeLayer: actions.remove,
  mergeLayerDown: actions.merge,
  renameLayer: actions.rename,
  commitLayerProps: vi.fn(),
  updateSelectedParameter: vi.fn(),
  addRasterLayer: actions.addRaster,
  addAdjustLayer: actions.addAdjust,
  addOutlineLayer: actions.addOutline,
  addClipLayer: actions.addClip,
})) as unknown as PaintEngine;

vi.mock('../engine/shapes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/shapes')>();
  return { ...actual, drawShape() {} };
});

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
  useStore.getState().set({
    layers,
    rootLayerIds: ['raster', 'shape'],
    activeLayerId: 'raster',
    selectedLayerIds: ['raster'],
    multiSelectMode: false,
  });
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
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
  it('keeps raster addition on + and groups all effects in the overflow menu', async () => {
    actions.addRaster.mockClear();
    actions.addAdjust.mockClear();
    actions.addOutline.mockClear();
    actions.addClip.mockClear();
    await renderPanel();
    await click(container.querySelector('[aria-label="レイヤーを追加"]'));
    expect(actions.addRaster).toHaveBeenCalledOnce();
    await click(container.querySelector('[aria-label="効果レイヤーを追加"]'));
    expect(menuItem('色調補正を追加')).not.toBeNull();
    expect(menuItem('縁どりを追加')).not.toBeNull();
    expect(menuItem('クリップを追加')).not.toBeNull();
    await click(menuItem('縁どりを追加'));
    expect(actions.addOutline).toHaveBeenCalledOnce();
  });
  it('lists lower layers first and marks the first selected layer as primary in multi-select', async () => {
    useStore.getState().set({
      selectedLayerIds: ['raster', 'shape'],
      multiSelectMode: true,
      activeLayerId: 'shape',
    });
    await renderPanel();
    const rows = [...container.querySelectorAll('.layer-row')];
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining('ラスター'),
      expect.stringContaining('直線'),
    ]);
    expect(rows[0].classList.contains('active')).toBe(true);
    expect(rows[0].querySelector('.primary-badge')?.textContent).toBe('主');
    expect(rows[1].classList.contains('selected')).toBe(true);
    expect(rows[1].classList.contains('active')).toBe(false);
  });
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
  it('does not toggle the long-pressed layer off via the following click', async () => {
    vi.useFakeTimers();
    actions.setActiveLayer.mockClear();
    actions.beginMultiSelect.mockClear();
    await renderPanel();
    const row = [...container.querySelectorAll('.layer-row')].find(el => el.textContent?.includes('直線'))!;
    await act(async () => {
      row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
      await vi.advanceTimersByTimeAsync(500);
      row.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(actions.beginMultiSelect).toHaveBeenCalledWith('shape');
    expect(actions.setActiveLayer).not.toHaveBeenCalled();
    expect(useStore.getState().multiSelectMode).toBe(true);
    expect(useStore.getState().selectedLayerIds).toEqual(['raster', 'shape']);
    vi.useRealTimers();
  });
  it('enters multi-select while keeping the first layer primary', async () => {
    actions.setActiveLayer.mockClear();
    actions.beginMultiSelect.mockClear();
    await renderPanel();
    const row = [...container.querySelectorAll('.layer-row')].find(el => el.textContent?.includes('直線'))!;
    await act(async () => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    });
    expect(actions.beginMultiSelect).toHaveBeenCalledWith('shape');
    expect(actions.setActiveLayer).not.toHaveBeenCalled();
    expect(useStore.getState().multiSelectMode).toBe(true);
    expect(useStore.getState().selectedLayerIds).toEqual(['raster', 'shape']);
  });
  it('shows a snap switch for a shape layer and keeps it out of mixed-type multi-select', async () => {
    await renderPanel();
    await click([...container.querySelectorAll('.layer-row')].find(el => el.textContent?.includes('直線'))!);
    const snap = container.querySelector('[aria-label="スナップ"]');
    expect(snap).not.toBeNull();
    expect(container.textContent).toContain('移動の端・中央、90°回転、多角形の頂点');
    await act(async () => {
      snap!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const extra: LayerMeta = {
      ...base,
      id: 'shape-off',
      name: '四角形',
      type: 'shape',
      snapEnabled: false,
      canRemove: true,
      shape: { kind: 'rect', x: 0, y: 0, width: 8, height: 8, color: '#000', strokeWidth: 1, paintMode: 'stroke' },
    };
    useStore.getState().set({
      layers: [...layers, extra],
      rootLayerIds: ['raster', 'shape', 'shape-off'],
      selectedLayerIds: ['shape', 'shape-off'],
      multiSelectMode: true,
      activeLayerId: 'shape',
    });
    await renderPanel();
    expect(container.querySelector('[aria-label="スナップ"]')).not.toBeNull();
    expect(container.textContent).toContain('—');
    useStore.getState().set({
      selectedLayerIds: ['shape', 'raster'],
      multiSelectMode: true,
      activeLayerId: 'shape',
    });
    await renderPanel();
    expect([...container.querySelectorAll('[aria-label="スナップ"]')].length).toBe(0);
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

describe('mask interactions', () => {
  const adjust: LayerMeta = {
    ...base,
    id: 'adjust',
    name: '補正',
    type: 'adjust',
    canRemove: true,
    params: { brightness: 100, contrast: 100, hue: 0, saturation: 100 },
    maskLayerIds: [],
  };

  it('adds a dragged layer to the active effect mask without moving it', async () => {
    (mockEngine.commitLayerProps as ReturnType<typeof vi.fn>).mockClear();
    useStore.getState().set({
      layers: [...layers, adjust],
      rootLayerIds: ['raster', 'shape', 'adjust'],
      activeLayerId: 'adjust',
      selectedLayerIds: ['adjust'],
    });
    await renderPanel();
    const target = container.querySelector('.mask-controls')!;
    const transfer = { getData: () => 'shape', dropEffect: '' };
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(dragOver, 'dataTransfer', { value: transfer });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: transfer });
    await act(async () => {
      target.dispatchEvent(dragOver);
      target.dispatchEvent(drop);
    });
    expect(mockEngine.commitLayerProps).toHaveBeenCalledWith(
      'adjust',
      { maskLayerIds: [] },
      { maskLayerIds: ['shape'] },
      'マスクを追加',
    );
  });

  it('scrolls to and pulses a mask source when its chip is clicked', async () => {
    const animate = vi.fn(() => ({ cancel() {} }));
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    useStore.getState().set({
      layers: [...layers, { ...adjust, maskLayerIds: ['shape'] }],
      rootLayerIds: ['raster', 'shape', 'adjust'],
      activeLayerId: 'adjust',
      selectedLayerIds: ['adjust'],
    });
    await renderPanel();
    animate.mockClear();
    await click(container.querySelector('[aria-label="直線をレイヤー一覧で表示"]'));
    expect((animate.mock.calls as unknown as [Keyframe[]][]).some(([frames]) =>
      Array.isArray(frames) && frames.some(frame => frame.transform === 'scale(1.06)'),
    )).toBe(true);
  });
});
