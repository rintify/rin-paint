import TextFieldsIcon from '@mui/icons-material/TextFields';
import type { ToolDescriptor } from '../types';
import { TextSettingsPanel } from './Panel';
import {
  DEFAULT_TEXT_TOOL_SETTINGS,
  normalizeTextToolSettings,
  type TextToolSettings,
} from './settings';
import { TextTool } from './tool';

export type { TextToolSettings };
export { DEFAULT_TEXT_TOOL_SETTINGS, normalizeTextToolSettings };

export const textTool: ToolDescriptor<TextToolSettings> = {
  kind: 'text',
  label: '文字',
  description: '部分書式と縦書き',
  icon: <TextFieldsIcon sx={{ fontSize: 20 }} />,
  category: 'root',
  capabilities: { color: true, size: false, multiSelect: false },
  settings: {
    default: () => ({ ...DEFAULT_TEXT_TOOL_SETTINGS }),
    normalize: normalizeTextToolSettings,
    Panel: TextSettingsPanel,
  },
  summary: (tool) => {
    const settings = normalizeTextToolSettings(tool.settings);
    return `${settings.sizePt}pt・${settings.direction === 'vertical' ? '縦書き' : '横書き'}`;
  },
  autoDeactivateAfterUse: true,
  create: (engine) => new TextTool(engine),
};
