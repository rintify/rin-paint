import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useEngine } from './EngineContext';
import { NameEditor } from './NameEditor';

type Target = { type: 'layer' | 'tool' | 'stack'; id: string };

/** キーボード対象の種類に依存する名称変更・削除をUI側で実行する。 */
export function ShortcutActions() {
  const engine = useEngine();
  const [rename, setRename] = useState<{ target: Target; name: string } | null>(null);
  const submit = useRef<(() => boolean) | null>(null);

  useEffect(() => {
    const currentTarget = (): Target | null => {
      const state = useStore.getState();
      const explicit = state.shortcutTarget;
      if (explicit?.type === 'layer' && state.layers.some(layer => layer.id === explicit.id)) return explicit;
      if (explicit?.type === 'tool' && state.tools.some(tool => tool.id === explicit.id)) return explicit;
      if (explicit?.type === 'stack' && state.toolStacks.some(stack => stack.id === explicit.id)) return explicit;
      return state.activeLayerId ? { type: 'layer', id: state.activeLayerId } : null;
    };
    const nameOf = (target: Target): string | null => {
      const state = useStore.getState();
      if (target.type === 'layer') return state.layers.find(layer => layer.id === target.id)?.name ?? null;
      if (target.type === 'tool') return state.tools.find(tool => tool.id === target.id)?.name ?? null;
      return state.toolStacks.find(stack => stack.id === target.id)?.name ?? null;
    };
    const handler = ({ command }: { command: 'rename-selection' | 'delete-selection' }) => {
      const target = currentTarget();
      if (!target) return;
      if (command === 'rename-selection') {
        const name = nameOf(target);
        if (name !== null) setRename({ target, name });
        return;
      }
      if (target.type === 'layer') {
        if (useStore.getState().layers.find(layer => layer.id === target.id)?.canRemove) engine.removeLayer(target.id);
      } else if (target.type === 'tool') {
        engine.removeToolInstance(target.id);
      } else {
        engine.dissolveToolStack(target.id);
      }
    };
    engine.events.on('shortcutCommand', handler);
    return () => engine.events.off('shortcutCommand', handler);
  }, [engine]);

  const commit = (value: string) => {
    if (!rename) return false;
    if (rename.target.type === 'layer') return engine.renameLayer(rename.target.id, value);
    if (rename.target.type === 'tool') return engine.renameToolInstance(rename.target.id, value);
    return engine.renameToolStack(rename.target.id, value);
  };

  return (
    <Dialog open={!!rename} onClose={() => setRename(null)} maxWidth="xs" fullWidth>
      <DialogTitle>名称を変更</DialogTitle>
      <DialogContent>
        {rename && (
          <NameEditor
            key={`${rename.target.type}:${rename.target.id}`}
            fullWidth
            value={rename.name}
            editing
            submitRef={submit}
            onCommit={commit}
            onCancel={() => setRename(null)}
            onEditingChange={() => setRename(null)}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onMouseDown={event => event.preventDefault()} onClick={() => setRename(null)}>キャンセル</Button>
        <Button variant="contained" onMouseDown={event => event.preventDefault()} onClick={() => submit.current?.()}>変更</Button>
      </DialogActions>
    </Dialog>
  );
}
