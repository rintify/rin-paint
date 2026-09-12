import ColorizeIcon from '@mui/icons-material/Colorize';
import type { ToolDescriptor } from '../types';
import { EyedropperSettingsPanel } from './Panel';
import { EyedropperTool } from './tool';
import {
  DEFAULT_EYEDROPPER_TOOL_SETTINGS,
  normalizeEyedropperToolSettings,
  type EyedropperToolSettings,
} from './settings';

export type { EyedropperSource, EyedropperToolSettings } from './settings';
export { DEFAULT_EYEDROPPER_TOOL_SETTINGS, normalizeEyedropperToolSettings };

export const eyedropperTool: ToolDescriptor<EyedropperToolSettings> = {
  kind: 'eyedropper',
  label: 'スポイト',
  description: 'キャンバスから色を取得',
  icon: <ColorizeIcon sx={{ fontSize: 20 }} />,
  category: 'root',
  capabilities: { color: false, size: false, multiSelect: true },
  settings: {
    default: () => ({ ...DEFAULT_EYEDROPPER_TOOL_SETTINGS }),
    normalize: normalizeEyedropperToolSettings,
    Panel: EyedropperSettingsPanel,
  },
  summary: (tool) => normalizeEyedropperToolSettings(tool.settings).source === 'final-color'
    ? '最終描画色'
    : '選択中のレイヤー',
  create: (engine) => new EyedropperTool(engine),
};
