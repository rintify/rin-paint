import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import {
  Box,
  ButtonBase,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { TOOL_KIND_LABELS, type ToolKind } from '../../types';
import { useEngine } from '../EngineContext';
import {
  ROOT_KINDS,
  SHAPE_KINDS,
  TOOL_DESCRIPTIONS,
  TOOL_ICONS,
  toolSearchHaystack,
} from './toolCatalog';

function ToolCatalogCard({ kind, path, onClick }: { kind: ToolKind; path?: string; onClick: () => void }) {
  return (
    <ButtonBase className="tool-catalog-card" onClick={onClick}>
      <Box className="tool-catalog-icon">{TOOL_ICONS[kind]}</Box>
      <Box sx={{ minWidth: 0, textAlign: 'left' }}>
        {path && <Typography variant="caption" color="text.secondary" noWrap>{path}</Typography>}
        <Typography variant="body2" sx={{ fontWeight: 650 }}>{TOOL_KIND_LABELS[kind]}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap>{TOOL_DESCRIPTIONS[kind]}</Typography>
      </Box>
    </ButtonBase>
  );
}

export function AddToolDialog({ onClose }: { onClose: () => void }) {
  const engine = useEngine();
  const [shapePage, setShapePage] = useState(false);
  const [query, setQuery] = useState('');
  const add = (kind: ToolKind) => {
    engine.addToolInstance(kind);
    onClose();
  };
  const normalized = query.trim().toLocaleLowerCase();
  const matched = useMemo(
    () => [...ROOT_KINDS, ...SHAPE_KINDS].filter(kind =>
      toolSearchHaystack(kind).toLocaleLowerCase().includes(normalized)),
    [normalized],
  );
  const results = normalized ? matched : shapePage ? SHAPE_KINDS : ROOT_KINDS;

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 2.5, overflow: 'hidden' } } }}
    >
      <DialogTitle sx={{ px: 2.5, py: 1.75, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {shapePage && !normalized && (
            <IconButton aria-label="ツールの種類に戻る" onClick={() => setShapePage(false)}>
              <ArrowBackIcon />
            </IconButton>
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" component="div" sx={{ fontSize: 17 }}>ツールを追加</Typography>
            <Typography variant="caption" color="text.secondary">
              {shapePage && !normalized ? '図形 › 種類を選択' : '追加する種類を選択'}
            </Typography>
          </Box>
          <IconButton onClick={onClose} aria-label="ツール追加を閉じる"><CloseIcon /></IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ p: '18px !important' }}>
        <TextField
          autoFocus
          fullWidth
          placeholder="ツールを検索"
          value={query}
          onChange={event => setQuery(event.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
              ),
            },
          }}
          sx={{ mb: 1.5 }}
        />
        <Box className="tool-catalog-scroll">
          <Box className="tool-catalog-grid">
            {!normalized && !shapePage && (
              <ButtonBase className="tool-catalog-card" onClick={() => setShapePage(true)}>
                <Box className="tool-catalog-icon">{TOOL_ICONS.rect}</Box>
                <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>図形</Typography>
                  <Typography variant="caption" color="text.secondary">直線・四角形・楕円・多角形</Typography>
                </Box>
                <ChevronRightIcon color="action" />
              </ButtonBase>
            )}
            {results.map(kind => (
              <ToolCatalogCard
                key={kind}
                kind={kind}
                path={normalized && SHAPE_KINDS.includes(kind) ? '図形' : undefined}
                onClick={() => add(kind)}
              />
            ))}
          </Box>
          {results.length === 0 && (
            <Box className="tool-catalog-empty">
              <Typography color="text.secondary">一致するツールがありません</Typography>
            </Box>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
