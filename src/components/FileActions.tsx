import { useEffect } from 'react';
import type { PaintEngine } from '../engine/PaintEngine';
import { appAlert, appConfirm } from './AppDialogs';
import { useEngine } from './EngineContext';

export type ImportFileKind = 'project' | 'settings';

export function importFileKind(file: Pick<File, 'name'>): ImportFileKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.rinpaint')) return 'project';
  if (name.endsWith('.rinsettings')) return 'settings';
  return null;
}

export async function importProjectWithConfirmation(
  engine: PaintEngine,
  file: File,
): Promise<void> {
  const ok = await appConfirm(
    '現在のページを読み込んだプロジェクトで置き換えます。よろしいですか？',
  );
  if (!ok) return;
  try {
    await engine.importProject(file);
  } catch {
    await appAlert('プロジェクトの読み込みに失敗しました');
  }
}

export async function importSettingsWithConfirmation(
  engine: PaintEngine,
  file: File,
): Promise<void> {
  const ok = await appConfirm(
    '登録ツール、ツールの並び・設定、色履歴、ショートカット、タイムラプス設定を読み込んだ内容で置き換えます。よろしいですか？',
  );
  if (!ok) return;
  try {
    await engine.importSettings(file);
    await appAlert('設定を読み込みました');
  } catch (error) {
    await appAlert(
      error instanceof Error ? error.message : '設定の読み込みに失敗しました',
    );
  }
}

function hasFiles(event: DragEvent): boolean {
  return [...(event.dataTransfer?.types ?? [])].includes('Files');
}

/** Global project/settings drop handling and the standard project-save shortcut. */
export function FileActions() {
  const engine = useEngine();

  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      const target = files.find(file => importFileKind(file) !== null);
      if (!target) return;
      event.preventDefault();
      const kind = importFileKind(target);
      if (kind === 'project') void importProjectWithConfirmation(engine, target);
      else if (kind === 'settings') void importSettingsWithConfirmation(engine, target);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.code !== 'KeyS' ||
        !event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.repeat
      ) return;
      event.preventDefault();
      void engine.exportProject().catch(error =>
        appAlert(error instanceof Error ? error.message : '保存に失敗しました'),
      );
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [engine]);

  return null;
}
