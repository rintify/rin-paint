import {
  Box,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { useStore } from '../state/store';
import { ColorControls } from './ColorControls';
import { HistoryControls } from './HistoryControls';
import { LayerPanel } from './LayerPanel';
import { MainMenu } from './MainMenu';
import { PenSettings } from './PenSettings';
import { StorageUsage } from './StorageUsage';
import { ToolPicker } from './ToolPicker';
import { TextToolSettings } from './TextToolSettings';
import { PageControls } from './PageControls';

function ExportProgress() {
  const progress = useStore((s) => s.exportProgress);
  if (progress === null) return null;
  const pct = Math.round(progress * 100);
  return (
    <Box sx={{ px: 1.75, pb: 1 }}>
      <LinearProgress variant="determinate" value={pct} sx={{ mb: 0.5, height: 5, borderRadius: 1 }} />
      <Typography variant="caption" color="text.secondary">
        タイムラプス書き出し中… {pct}%
      </Typography>
    </Box>
  );
}

export function LeftPanel() {
  return (
    <Box
      component="aside"
      className="left-panel"
      sx={{
        width: 400,
        flex: 'none',
        bgcolor: 'background.paper',
        borderRight: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', justifyContent: 'space-between', px: 1.75, pt: 1.5, pb: 1 }}
      >
        <Stack direction="row" spacing={.75} sx={{ alignItems: 'center' }}>
          <Typography variant="subtitle1" component="h1" sx={{ m: 0, letterSpacing: 0.5, fontWeight: 600 }}>rin-paint</Typography>
          <PageControls />
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <HistoryControls />
          <PageControls compact />
          <MainMenu />
        </Stack>
      </Stack>
      <ExportProgress />
      <Box className="left-panel-workspace">
        <ToolPicker />
        <Box className="left-panel-inspector">
          <Box className="tool-settings-pane">
            <Box className="pane-heading">
              <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>
                ツールの設定
              </Typography>
            </Box>
            <Box className="pane-scroll">
              <TextToolSettings />
              <PenSettings />
              <ColorControls />
            </Box>
          </Box>
          <Box className="layers-pane">
            <LayerPanel />
          </Box>
        </Box>
      </Box>
      <StorageUsage />
    </Box>
  );
}
