import ImageIcon from '@mui/icons-material/Image';
import type { ToolDescriptor } from '../types';
import { ImageSettingsPanel } from './Panel';
import {
  DEFAULT_IMAGE_TOOL_SETTINGS,
  normalizeImageToolSettings,
  type ImageToolSettings,
} from './settings';
import { ImageTool } from './tool';

export type { ImageToolSettings };
export { DEFAULT_IMAGE_TOOL_SETTINGS, normalizeImageToolSettings };

export const imageTool: ToolDescriptor<ImageToolSettings> = {
  kind: 'image',
  label: '画像',
  description: '指定位置に画像を配置',
  icon: <ImageIcon sx={{ fontSize: 20 }} />,
  category: 'root',
  capabilities: { color: false, size: false, multiSelect: false },
  settings: {
    default: () => ({ ...DEFAULT_IMAGE_TOOL_SETTINGS }),
    normalize: normalizeImageToolSettings,
    Panel: ImageSettingsPanel,
  },
  summary: (tool) => {
    const settings = normalizeImageToolSettings(tool.settings);
    return `${settings.widthMm} × ${settings.heightMm} mm`;
  },
  create: (engine) => new ImageTool(engine),
};
