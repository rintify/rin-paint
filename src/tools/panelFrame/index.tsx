import ViewQuiltOutlinedIcon from '@mui/icons-material/ViewQuiltOutlined';
import type { ToolDescriptor } from '../types';
import { PanelFrameSettingsPanel } from './Panel';
import { PanelFrameTool } from './tool';
import { DEFAULT_PANEL_FRAME_TOOL_SETTINGS, normalizePanelFrameToolSettings, type PanelFrameToolSettings } from './settings';

export const panelFrameTool: ToolDescriptor<PanelFrameToolSettings> = {
  kind: 'panelFrame',
  label: 'コマ',
  description: '描画用ラスターとクリップ、枠をまとめて作成',
  icon: <ViewQuiltOutlinedIcon sx={{ fontSize: 20 }} />,
  category: 'shape',
  capabilities: { color: true, size: true, multiSelect: false },
  initialColor: '#ffffff',
  initialSizeMm: 1,
  colorLabel: '塗り色',
  allowTransparentColor: false,
  sizeLabel: '枠の太さ',
  settings: {
    default: () => ({ ...DEFAULT_PANEL_FRAME_TOOL_SETTINGS }),
    normalize: normalizePanelFrameToolSettings,
    Panel: PanelFrameSettingsPanel,
  },
  autoDeactivateAfterUse: true,
  create: engine => new PanelFrameTool(engine),
};

export * from './settings';
