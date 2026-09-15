// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineProvider } from './EngineContext';
import { useStore } from '../state/store';
import type { PaintEngine } from '../engine/PaintEngine';
vi.mock('./TextEditor', () => ({ TextEditor: () => null }));
import { PageView } from './PageView';

const setConstrained = vi.hoisted(() => vi.fn());
const mockEngine = vi.hoisted(() => ({
  transformEdit: { mode: 'scale' },
  view: { snapshot: () => ({ x: 75, y: -30, scale: 1.5, rot: 0.4 }) },
  attach() {},
  detach() {},
  setFitWidth() {},
  requestRender() {},
  requestOverlayRender() {},
  resetView() {},
  setShapeHandleEdgeConstrained: setConstrained,
  deleteSelectedShapeVertex() {},
})) as unknown as PaintEngine;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  setConstrained.mockClear();
  useStore.getState().set({
    pageBusy: false,
    loadingPage: null,
    polygonDraftActive: false,
    shapeHandleSelected: true,
    shapeHandleCanDelete: true,
    shapeHandleIsVertex: true,
    shapeHandleEdgeConstrained: false,
    pageW: 160, pageH: 120,
    activeToolId: null,
    tool: null,
  });
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('polygon vertex edge constraint UI', () => {
  it('shows the follow-edge toggle only while a vertex is selected and resets with selection', async () => {
    await act(async () => root.render(<EngineProvider engine={mockEngine}><PageView /></EngineProvider>));
    const toggle = [...container.querySelectorAll('button')].find(button => button.textContent === '辺に沿う');
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute('aria-pressed')).toBe('false');
    await act(async () => toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(setConstrained).toHaveBeenCalledWith(true);
    await act(async () => useStore.getState().set({ shapeHandleSelected: false, shapeHandleEdgeConstrained: false }));
    expect([...container.querySelectorAll('button')].some(button => button.textContent === '辺に沿う')).toBe(false);
  });
});

describe('page loading overlay', () => {
  it('marks the canvas busy and keeps the overlay mounted for its exit transition', async () => {
    await act(async () => {
      useStore.getState().set({ pageBusy: true });
      root.render(<EngineProvider engine={mockEngine}><PageView /></EngineProvider>);
    });
    const overlay = container.querySelector('[data-testid="page-loading-overlay"]')!;
    expect(overlay.getAttribute('aria-hidden')).toBe('false');
    expect(container.querySelector('.canvas-area')?.getAttribute('aria-busy')).toBe('true');
    expect(overlay.querySelector('[aria-label="ページを読み込み中"]')).not.toBeNull();
    const center = container.querySelector<HTMLElement>('[data-testid="page-loading-center"]')!;
    expect(center.style.left).toBe('calc(50% + 75px)');
    expect(center.style.top).toBe('calc(50% + -30px)');
    await act(async () => useStore.getState().set({ pageBusy: false }));
    expect(container.querySelector('[data-testid="page-loading-overlay"]')).toBe(overlay);
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
  });
});


it('shows the destination preview immediately while the source remains loaded', async () => {
  await act(async () => {
    useStore.getState().set({
      activePageId: 'source', pageBusy: true,
      loadingPage: { id: 'destination', spec: { widthMm: 100, heightMm: 100, ppi: 100 } },
    });
    root.render(<EngineProvider engine={mockEngine}><PageView /></EngineProvider>);
  });
  expect(container.querySelector('[data-testid="page-loading-preview"]')?.getAttribute('data-page-id')).toBe('destination');
  expect(useStore.getState().activePageId).toBe('source');
  await act(async () => useStore.getState().set({ pageBusy: false, loadingPage: null }));
  expect(container.querySelector('[data-testid="page-loading-preview"]')).toBeNull();
});
