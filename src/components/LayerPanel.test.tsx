// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state/store';
import type { LayerMeta } from '../types';
import { LayerPanel } from './LayerPanel';

const actions = vi.hoisted(() => ({ remove: vi.fn(), merge: vi.fn(async () => undefined) }));
vi.mock('../engine/PaintEngine', () => ({ engine: {
  layerRootIds: () => ['raster', 'shape'],
  getLayerCanvas: () => null,
  setActiveLayer: (id: string) => useStore.getState().set({ activeLayerId: id }),
  canMoveLayer: () => true,
  canRemoveLayer: (id: string) => id === 'shape',
  canMergeLayerDown: (id: string) => id === 'shape',
  canTransferShape: () => false,
  getShape: () => null,
  removeLayer: actions.remove,
  mergeLayerDown: actions.merge,
} }));
vi.mock('../engine/shapes', () => ({ drawShape() {} }));
const base = { name: 'ラスター', opacity: 1, blend: 'source-over' as const, visible: true, parentId: null, childIds: [], version: 0 };
const layers: LayerMeta[] = [{ ...base, id: 'raster', type: 'raster' }, { ...base, id: 'shape', name: '直線', type: 'shape', shape: { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10, width: 1, color: '#123456' } }];
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect() {}, save() {}, scale() {}, restore() {} } as unknown as CanvasRenderingContext2D);
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: () => ({ cancel() {} }) });
  useStore.getState().set({ layers, activeLayerId: 'raster' });
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => { element!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}
function menuItem(label: string): Element | null {
  return [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent === label) ?? null;
}
describe('layer settings entry points', () => {
  it('keeps raster settings hidden until requested, and allows closing with X', async () => {
    await act(async () => root.render(<LayerPanel />));
    expect(container.querySelector('.layer-controls-palette')).toBeNull();
    await click(container.querySelector('[aria-label="ラスターのメニュー"]'));
    expect(menuItem('削除')?.getAttribute('aria-disabled')).toBe('true');
    await click(menuItem('レイヤーの設定'));
    expect(container.querySelector('.layer-controls-palette')).not.toBeNull();
    await click(container.querySelector('[aria-label="レイヤーの設定を閉じる"]'));
    expect(container.querySelector('.layer-controls-palette')).toBeNull();
  });
  it('opens shape settings on selection once, respects closing, and targets the clicked menu', async () => {
    await act(async () => root.render(<LayerPanel />));
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
