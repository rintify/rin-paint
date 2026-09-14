import RestoreIcon from '@mui/icons-material/Restore';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import {
  defaultShortcutBindings,
  shortcutDefinitions,
  shortcutFromEvent,
  shortcutLabel,
  type ShortcutBindings,
  type ShortcutId,
} from '../shortcuts';
import { useStore } from '../state/store';

export function ShortcutSettingsDialog({ onClose }: { onClose: () => void }) {
  const tools = useStore(state => state.tools);
  const saved = useStore(state => state.shortcuts);
  const [draft, setDraft] = useState<ShortcutBindings>(() => ({ ...saved }));
  const [recording, setRecording] = useState<ShortcutId | null>(null);
  const conflicts = useMemo(() => {
    const owners = new Map<string, ShortcutId[]>();
    for (const item of shortcutDefinitions) {
      const binding = draft[item.id];
      if (binding) owners.set(binding, [...(owners.get(binding) ?? []), item.id]);
    }
    return new Set([
      ...[...owners.values()].filter(ids => ids.length > 1).flat(),
      ...shortcutDefinitions.filter(item => draft[item.id] && tools.some(tool => tool.shortcut === draft[item.id])).map(item => item.id),
    ]);
  }, [draft, tools]);
  const categories = [...new Set(shortcutDefinitions.map(item => item.category))];

  const record = (event: React.KeyboardEvent, id: ShortcutId) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { setRecording(null); return; }
    const binding = shortcutFromEvent(event.nativeEvent);
    if (!binding) return;
    setDraft(current => ({ ...current, [id]: binding }));
    setRecording(null);
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>ショートカット管理</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          アプリのショートカット定義から自動で一覧化しています。キー欄を押し、新しいキーを入力してください。
        </Typography>
        {conflicts.size > 0 && <Alert severity="error" sx={{ mb: 2 }}>同じキーの割り当てが重複しています。ツールの割り当ては「ツールを管理」から変更できます。</Alert>}
        {categories.map((category, categoryIndex) => (
          <Box key={category}>
            {categoryIndex > 0 && <Divider sx={{ my: 1.5 }} />}
            <Typography variant="overline" color="text.secondary">{category}</Typography>
            <Stack spacing={0.75}>
              {shortcutDefinitions.filter(item => item.category === category).map(item => (
                <Stack key={item.id} direction="row" spacing={1} sx={{ alignItems: 'center', minHeight: 42 }}>
                  <Typography variant="body2" sx={{ flex: 1 }}>{item.label}</Typography>
                  <Button
                    variant={recording === item.id ? 'contained' : 'outlined'}
                    color={conflicts.has(item.id) ? 'error' : 'primary'}
                    sx={{ minWidth: 132, fontFamily: 'monospace' }}
                    onClick={() => setRecording(item.id)}
                    onKeyDown={event => recording === item.id && record(event, item.id)}
                  >
                    {recording === item.id ? 'キーを入力…' : shortcutLabel(draft[item.id])}
                  </Button>
                  <Button size="small" onClick={() => setDraft(current => ({ ...current, [item.id]: '' }))}>解除</Button>
                </Stack>
              ))}
            </Stack>
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button startIcon={<RestoreIcon />} onClick={() => { setDraft(defaultShortcutBindings()); setRecording(null); }}>初期値に戻す</Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>キャンセル</Button>
        <Button
          variant="contained"
          disabled={conflicts.size > 0 || !!recording}
          onClick={() => { useStore.getState().set({ shortcuts: draft }); onClose(); }}
        >
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}
