import {
  Box,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { useStore } from '../state/store';
import { HistoryControls } from './HistoryControls';
import { HierarchyPanel } from './HierarchyPanel';
import { MainMenu } from './MainMenu';
import { PageManagerButton, PageStepper } from './PageControls';
import { StorageUsage } from './StorageUsage';
import { ToolPicker } from './ToolPicker';
import { ToolSettingsHost } from './ToolSettingsHost';

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
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Typography variant="subtitle1" component="h1" sx={{ m: 0, letterSpacing: 0.5, fontWeight: 600 }}>
            rin-paint
          </Typography>
          <PageStepper />
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <HistoryControls />
          <PageManagerButton />
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
              <ToolSettingsHost />
            </Box>
          </Box>
          <Box className="hierarchy-pane">
            <HierarchyPanel />
          </Box>
        </Box>
      </Box>
      <StorageUsage />
    </Box>
  );
}
