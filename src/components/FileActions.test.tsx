// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaintEngine } from '../engine/PaintEngine';
import { AppDialogs, useDialogStore } from './AppDialogs';
import { EngineProvider } from './EngineContext';
import { FileActions, importFileKind } from './FileActions';

let root: Root;
let host: HTMLDivElement;
const exportProject = vi.fn(() => Promise.resolve());
const importProject = vi.fn(() => Promise.resolve());
const importSettings = vi.fn(() => Promise.resolve());
const engine = {
  exportProject,
  importProject,
  importSettings,
} as unknown as PaintEngine;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  exportProject.mockClear();
  importProject.mockClear();
  importSettings.mockClear();
  useDialogStore.setState({ queue: [] });
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root.render(
    <EngineProvider engine={engine}>
      <FileActions />
      <AppDialogs />
    </EngineProvider>,
  ));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useDialogStore.setState({ queue: [] });
});

function drop(file: File): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files: [file], types: ['Files'] },
  });
  return event;
}

function confirmButton(): HTMLButtonElement {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    .find(button => button.textContent === 'OK')!;
}

describe('FileActions', () => {
  it('recognizes import files by their case-insensitive extension', () => {
    expect(importFileKind({ name: 'drawing.RINPAINT' })).toBe('project');
    expect(importFileKind({ name: 'tools.rinsettings' })).toBe('settings');
    expect(importFileKind({ name: 'image.png' })).toBeNull();
  });

  it('downloads the project for Command+S', async () => {
    const event = new KeyboardEvent('keydown', {
      code: 'KeyS',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(exportProject).toHaveBeenCalledOnce();
  });

  it('confirms a dropped project before importing it', async () => {
    const event = drop(new File(['project'], 'drawing.rinpaint'));
    await act(async () => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(importProject).not.toHaveBeenCalled();
    await act(async () => confirmButton().click());
    expect(importProject).toHaveBeenCalledOnce();
  });

  it('confirms dropped settings before importing them', async () => {
    const event = drop(new File(['settings'], 'tools.rinsettings'));
    await act(async () => window.dispatchEvent(event));
    expect(importSettings).not.toHaveBeenCalled();
    await act(async () => confirmButton().click());
    expect(importSettings).toHaveBeenCalledOnce();
  });
});
