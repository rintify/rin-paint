// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaintEngine } from './PaintEngine';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const init = deferred(), text = deferred(), rendered = deferred();
  const resume = vi.fn();
  const engine = {
    attachmentGeneration: 0,
    init: vi.fn(() => init.promise), syncStore: vi.fn(),
    view: { attach: vi.fn() },
    compositor: {
      suspendPresentation: vi.fn(() => resume),
      attachCanvases: vi.fn(), textRenderer: { ready: () => text.promise },
      renderNextFrame: vi.fn(() => rendered.promise),
    },
    input: { attachListeners: vi.fn() },
  };
  const attach = () => PaintEngine.prototype.attach.call(engine as unknown as PaintEngine,
    document.createElement('canvas'), document.createElement('canvas'),
    document.createElement('div'), document.createElement('div'));
  return { engine, init, text, rendered, attach, resume };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('startup presentation', () => {
  it('waits for restoration, text and the rendered frame before accepting input or becoming ready', async () => {
    const { engine, init, text, rendered, attach, resume } = setup();
    const ready = vi.fn();
    const completion = attach().then(ready);
    expect(engine.syncStore).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    init.resolve(); await vi.runAllTimersAsync();
    expect(engine.syncStore).toHaveBeenCalledOnce();
    expect(engine.compositor.renderNextFrame).not.toHaveBeenCalled();
    text.resolve(); await vi.runAllTimersAsync();
    expect(engine.compositor.renderNextFrame).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    expect(ready).not.toHaveBeenCalled();
    expect(engine.input.attachListeners).not.toHaveBeenCalled();
    rendered.resolve(); await completion;
    expect(engine.input.attachListeners).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledOnce();
  });

  it('ignores an obsolete attachment when StrictMode attaches again during startup', async () => {
    const { engine, init, text, rendered, attach } = setup();
    const first = attach(), second = attach();
    init.resolve(); text.resolve(); rendered.resolve();
    await vi.runAllTimersAsync(); await Promise.all([first, second]);
    expect(engine.syncStore).toHaveBeenCalledOnce();
    expect(engine.input.attachListeners).toHaveBeenCalledOnce();
  });

  it('propagates initialization failure without enabling input', async () => {
    const { engine, attach } = setup();
    engine.init.mockRejectedValue(new Error('storage unavailable'));
    await expect(attach()).rejects.toThrow('storage unavailable');
    expect(engine.input.attachListeners).not.toHaveBeenCalled();
  });
});
