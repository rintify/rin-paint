import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import type { ToolDescriptor } from '../types';
import { SpeechBubbleSettingsPanel } from './Panel';
import { SpeechBubbleTool } from './tool';
import { DEFAULT_SPEECH_BUBBLE_TOOL_SETTINGS, normalizeSpeechBubbleToolSettings, type SpeechBubbleToolSettings } from './settings';

export const speechBubbleTool: ToolDescriptor<SpeechBubbleToolSettings> = {
  kind: 'speechBubble',
  label: '吹き出し',
  description: '本体、しっぽ、枠、縦書き文字をまとめて作成',
  icon: <ChatBubbleOutlineIcon sx={{ fontSize: 20 }} />,
  category: 'shape',
  capabilities: { color: true, size: true, multiSelect: false },
  initialColor: '#ffffff',
  initialSizeMm: 1,
  colorLabel: '塗り色',
  allowTransparentColor: false,
  sizeLabel: '枠の太さ',
  settings: {
    default: () => ({ ...DEFAULT_SPEECH_BUBBLE_TOOL_SETTINGS }),
    normalize: normalizeSpeechBubbleToolSettings,
    Panel: SpeechBubbleSettingsPanel,
  },
  autoDeactivateAfterUse: true,
  create: engine => new SpeechBubbleTool(engine),
};

export * from './settings';
