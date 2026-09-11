// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NameEditor } from './NameEditor';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function input() { return container.querySelector('input') as HTMLInputElement; }
function type(value: string) {
  const element = input();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
}

describe('NameEditor', () => {
  it('keeps an empty local draft and allows a one-character name', async () => {
    const commit = vi.fn(() => true);
    await act(async () => root.render(<NameEditor value="元の名前" editing onCommit={commit} onCancel={() => {}} />));
    await act(async () => {
      type('');
    });
    expect(commit).not.toHaveBeenCalled();
    await act(async () => {
      type('名');
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(commit).toHaveBeenCalledWith('名');
  });

  it('does not submit the Enter used to confirm IME composition', async () => {
    let now = 10;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const commit = vi.fn(() => true);
    await act(async () => root.render(<NameEditor value="名前" editing onCommit={commit} onCancel={() => {}} />));
    await act(async () => {
      input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
      input().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });
    expect(commit).not.toHaveBeenCalled();
    now = 200;
    await act(async () => input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('rejects whitespace without replacing the draft', async () => {
    const commit = vi.fn(() => true);
    await act(async () => root.render(<NameEditor value="名前" editing onCommit={commit} onCancel={() => {}} />));
    await act(async () => {
      type('   ');
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(commit).not.toHaveBeenCalled();
    expect(input().value).toBe('   ');
    expect(container.textContent).toContain('空白だけの名称は使えません');
  });
});
