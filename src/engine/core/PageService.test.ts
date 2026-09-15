// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PageService } from './PageService';
import type { PaintEngine } from '../PaintEngine';
import { useStore } from '../../state/store';

const mocks = vi.hoisted(() => ({ loadPage: vi.fn(), rollback: vi.fn() }));
vi.mock('../persistence/db', () => ({
  loadPage: mocks.loadPage, setPersistencePageId: vi.fn(), saveProjectMeta: vi.fn(),
  savePage: vi.fn(), deletePageData: vi.fn(), collectUnusedRasterAssets: vi.fn(),
}));
vi.mock('./RuntimeCheckpoint', () => ({ runtimeCheckpoint: () => mocks.rollback }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const saved = deferred(), rendered = deferred();
  let busy = false;
  const eng = {
    isBusy: () => busy || useStore.getState().pageBusy,
    setBusy: (value: boolean) => { busy = value; },
    layerService: { finishFloating: vi.fn(), exitMultiSelect: vi.fn() },
    cancelSessions: vi.fn(), activeTool: () => ({ cancel: vi.fn() }),
    cursor: { cancel: vi.fn() }, input: { resetPageInteraction: vi.fn() },
    shapeEdit: { resetPageInteraction: vi.fn(), refreshVertexState: vi.fn() },
    syncStore: vi.fn(), history: {},
    autosave: { flushForPageSwitch: () => saved.promise, failed: false },
    links: { flush: vi.fn(), reconcileAll: vi.fn() },
    recorderPublic: () => ({ reset: vi.fn() }),
    restoreSavedPagePublic: vi.fn(), events: { emit: vi.fn() },
    compositor: { renderNextFrame: () => rendered.promise },
    scheduleSave: vi.fn(), document: { mode: 'edit', getPage: () => ({ spec: { widthMm: 100, heightMm: 100, ppi: 100 } }) },
  } as unknown as PaintEngine;
  const pages = new PageService(eng);
  pages.pageOrder = ['a', 'b', 'c']; pages.activePageId = 'a';
  return { eng, pages, saved, rendered };
}
beforeEach(() => {
  vi.useFakeTimers();
  useStore.getState().set({ pageBusy: false, loadingPage: null, fillProgress: null });
  mocks.loadPage.mockReset().mockResolvedValue({ id: 'b' });
  mocks.rollback.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe('page transition', () => {
  it('cleans old interactions, blocks overlapping switches, and waits for the presented frame', async () => {
    const { eng, pages, saved, rendered } = setup();
    const switching = pages.switchPage('b');
    expect(useStore.getState().pageBusy).toBe(true);
    expect(useStore.getState().loadingPage?.id).toBe('b');
    expect(pages.activePageId).toBe('a');
    expect(eng.input.resetPageInteraction).toHaveBeenCalledOnce();
    expect(eng.shapeEdit.resetPageInteraction).toHaveBeenCalledOnce();
    expect(eng.cursor.cancel).toHaveBeenCalledOnce();
    expect(eng.layerService.exitMultiSelect).not.toHaveBeenCalled();
    await pages.switchPage('c');
    await vi.runAllTimersAsync();
    expect(mocks.loadPage).not.toHaveBeenCalled();
    saved.resolve();
    await vi.runAllTimersAsync();
    expect(mocks.loadPage).toHaveBeenCalledExactlyOnceWith('b', false);
    expect(useStore.getState().pageBusy).toBe(true);
    rendered.resolve(); await switching;
    expect(useStore.getState().pageBusy).toBe(false);
    expect(pages.activePageId).toBe('b');
    expect(useStore.getState().loadingPage).toBeNull();
    expect(eng.restoreSavedPagePublic).toHaveBeenCalledWith({ id: 'b' }, { preserveView: true });
  });

  it('restores the previous page on a decode failure and releases the loading state', async () => {
    const { eng, pages, saved } = setup();
    vi.mocked(eng.restoreSavedPagePublic).mockRejectedValue(new Error('decode failed'));
    const switching = pages.switchPage('b');
    const rejected = expect(switching).rejects.toThrow('decode failed');
    saved.resolve(); await vi.runAllTimersAsync(); await rejected;
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(useStore.getState().loadingPage).toBeNull();
    expect(pages.activePageId).toBe('a');
    expect(eng.isBusy()).toBe(false);
    expect(useStore.getState().pageBusy).toBe(false);
  });
});
