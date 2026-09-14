import { describe, expect, it } from 'vitest';
import { DEFAULT_PANEL_FRAME_TOOL_SETTINGS, normalizePanelFrameToolSettings } from './panelFrame/settings';
import { DEFAULT_SPEECH_BUBBLE_TOOL_SETTINGS, normalizeSpeechBubbleToolSettings } from './speechBubble/settings';
import { GEN_EI_ANTIQUE_FONT_ID } from '../engine/text/fonts';

describe('generated tool settings', () => {
  it('normalizes panel defaults', () => {
    expect(normalizePanelFrameToolSettings(undefined)).toEqual(DEFAULT_PANEL_FRAME_TOOL_SETTINGS);
    expect(normalizePanelFrameToolSettings({ outlineColor: 'bad', constrainAspect: 1 })).toEqual(DEFAULT_PANEL_FRAME_TOOL_SETTINGS);
  });

  it('clamps speech bubble settings and preserves supported choices', () => {
    expect(normalizeSpeechBubbleToolSettings({
      bodyKind: 'rect', tailStyle: 'rounds', circleCount: 99, tailWidthMm: -2,
      fontSizePt: 900, textPaddingMm: -1, outlineColor: '#123456', textColor: '#abcdef',
    })).toMatchObject({
      bodyKind: 'rect', tailStyle: 'rounds', circleCount: 20, tailWidthMm: .01,
      fontSizePt: 512, textPaddingMm: 0, outlineColor: '#123456', textColor: '#abcdef',
    });
    expect(normalizeSpeechBubbleToolSettings(undefined)).toEqual(DEFAULT_SPEECH_BUBBLE_TOOL_SETTINGS);
  });

  it('uses GenEi Antique for new speech bubbles', () => {
    expect(DEFAULT_SPEECH_BUBBLE_TOOL_SETTINGS.fontId).toBe(GEN_EI_ANTIQUE_FONT_ID);
  });
});
