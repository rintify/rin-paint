// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state/store';
import { PreferencesDialog } from './PreferencesDialog';

describe('PreferencesDialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    useStore.getState().set({ autoLinkOnPaste: false });
  });

  it('shows the preference off by default and updates it through the switch', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<PreferencesDialog onClose={vi.fn()} />));

    const input = document.querySelector<HTMLInputElement>('#auto-link-on-paste')!;
    expect(input.checked).toBe(false);
    await act(async () => input.click());
    expect(useStore.getState().autoLinkOnPaste).toBe(true);

    await act(async () => root.unmount());
  });
});
