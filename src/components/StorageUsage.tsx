import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {
  Box,
  Button,
  Divider,
  List,
  ListItem,
  ListItemText,
  Menu,
  Typography,
} from '@mui/material';
import { useState, type MouseEvent } from 'react';
import { useStore } from '../state/store';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i++) {
    value /= 1024;
    unit = units[i];
  }
  const digits = value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${unit}`;
}

export function StorageUsage() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const usage = useStore((s) => s.storageUsage);
  const historyCount = useStore((s) => s.historyCount);

  const rows = [
    { label: `履歴（${historyCount}件）`, value: usage.history },
    { label: '自動保存プロジェクト', value: usage.project },
    { label: 'タイムラプス', value: usage.timelapse },
    { label: 'その他', value: usage.other },
  ];

  return (
    <Box sx={{ flex: 'none', px: 1.75, py: 1, borderTop: 1, borderColor: 'divider' }}>
      <Button
        fullWidth
        size="small"
        onClick={(e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)}
        startIcon={<InfoOutlinedIcon sx={{ fontSize: 14 }} />}
        sx={{
          justifyContent: 'flex-start',
          fontSize: 10.5,
          fontVariantNumeric: 'tabular-nums',
          color: 'text.secondary',
        }}
        title="データ使用量の内訳を表示"
        aria-expanded={!!anchor}
      >
        使用量（概算） {formatBytes(usage.total)}
      </Button>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { width: 276, p: 0.5 } } }}
      >
        <Typography variant="subtitle2" sx={{ px: 1.5, pt: 1, pb: 0.5 }}>
          使用量の内訳
        </Typography>
        <List dense disablePadding>
          {rows.map((row) => (
            <ListItem key={row.label} dense sx={{ py: 0.25 }}>
              <ListItemText primary={row.label} />
              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatBytes(row.value)}
              </Typography>
            </ListItem>
          ))}
          <Divider sx={{ my: 0.5 }} />
          <ListItem dense>
            <ListItemText primary="合計" />
            <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
              {formatBytes(usage.total)}
            </Typography>
          </ListItem>
        </List>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, pb: 1, pt: 0.5 }}>
          履歴はメモリ上の保持データ、ほかはブラウザ保存領域の概算です。
        </Typography>
      </Menu>
    </Box>
  );
}
