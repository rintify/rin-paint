// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineProvider } from './EngineContext';
import { useStore } from '../state/store';
import type { PaintEngine } from '../engine/PaintEngine';
vi.mock('./TextEditor', () => ({ TextEditor: () => null }));
vi.mock('./ReferenceImageWindow', () => ({
  ReferenceImageWindow: () => null,
  handleReferenceImageDrop: () => false,
}));
import { CanvasView } from './CanvasView';

const setConstrained = vi.hoisted(() => vi.fn());
const mockEngine = vi.hoisted(() => ({
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
    polygonDraftActive: false,
    shapeHandleSelected: true,
    shapeHandleCanDelete: true,
    shapeHandleIsVertex: true,
    shapeHandleEdgeConstrained: false,
    canvasW: 160, canvasH: 120,
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
    await act(async () => root.render(<EngineProvider engine={mockEngine}><CanvasView /></EngineProvider>));
    const toggle = [...container.querySelectorAll('button')].find(button => button.textContent === '辺に沿う');
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute('aria-pressed')).toBe('false');
    await act(async () => toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(setConstrained).toHaveBeenCalledWith(true);
    await act(async () => useStore.getState().set({ shapeHandleSelected: false, shapeHandleEdgeConstrained: false }));
    expect([...container.querySelectorAll('button')].some(button => button.textContent === '辺に沿う')).toBe(false);
  });
});
