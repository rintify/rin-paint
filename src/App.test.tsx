// @vitest-environment happy-dom
import { act, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const signals = vi.hoisted(() => ({ onReady: () => {}, onError: (_error: unknown) => {} }));
vi.mock('./components/EngineContext', () => ({ EngineProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('./components/LeftPanel', () => ({ LeftPanel: () => <div>panel</div> }));
vi.mock('./components/PageView', () => ({ PageView: (props: typeof signals) => { Object.assign(signals, props); return <canvas />; } }));
vi.mock('./components/ShortcutActions', () => ({ ShortcutActions: () => <span data-testid="shortcuts" /> }));
vi.mock('./components/FileActions', () => ({ FileActions: () => null }));
import App from './App';
let container: HTMLDivElement, root: Root;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
  await act(async () => root.render(<StrictMode><App /></StrictMode>));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('keeps the measuring layout mounted but hidden and inert until the canvas is ready', async () => {
  const app = container.querySelector('.app')!;
  expect(app.classList.contains('app-starting')).toBe(true);
  expect(app.hasAttribute('inert')).toBe(true);
  expect(app.querySelector('canvas')).not.toBeNull();
  expect(container.querySelector('[data-testid="shortcuts"]')).toBeNull();
  await act(async () => signals.onReady());
  expect(app.classList.contains('app-starting')).toBe(false);
  expect(app.hasAttribute('inert')).toBe(false);
  expect(container.querySelector('.startup-screen')?.getAttribute('aria-hidden')).toBe('true');
  expect(container.querySelector('[data-testid="shortcuts"]')).not.toBeNull();
});

it('offers a GUI recovery action when startup fails', async () => {
  await act(async () => signals.onError(new Error('failed')));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('読み込みを完了できませんでした');
  expect(container.querySelector('button')?.textContent).toBe('再読み込み');
  expect(container.querySelector('.app')?.hasAttribute('inert')).toBe(true);
});
