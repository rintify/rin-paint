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
import {
  getToolDescriptor,
  TOOL_KINDS,
  TOOL_REGISTRY,
  type ToolKind,
} from '../../tools/registry';
import { useEngine } from '../EngineContext';

const ROOT_KINDS = TOOL_KINDS.filter((kind) => TOOL_REGISTRY[kind].category === 'root');
const SHAPE_KINDS = TOOL_KINDS.filter((kind) => TOOL_REGISTRY[kind].category === 'shape');

function toolSearchHaystack(kind: ToolKind): string {
  const d = TOOL_REGISTRY[kind];
  return `${d.label} ${d.description} ${d.category === 'shape' ? '図形' : ''}`;
}

function ToolCatalogCard({ kind, path, onClick }: { kind: ToolKind; path?: string; onClick: () => void }) {
  const d = TOOL_REGISTRY[kind];
  return (
    <ButtonBase className="tool-catalog-card" onClick={onClick}>
      <Box className="tool-catalog-icon">{d.icon}</Box>
      <Box sx={{ minWidth: 0, textAlign: 'left' }}>
        {path && <Typography variant="caption" color="text.secondary" noWrap>{path}</Typography>}
        <Typography variant="body2" sx={{ fontWeight: 650 }}>{d.label}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap>{d.description}</Typography>
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
                <Box className="tool-catalog-icon">{getToolDescriptor('rect')?.icon}</Box>
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
