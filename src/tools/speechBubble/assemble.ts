import {
  createOutlineLayer,
  createShapeLayer,
  createTextLayer,
  type Layer,
} from '../../engine/layers';
import type { LayerAddress, ShapeParams } from '../../model';
import { newText } from '../../engine/text/model';

export interface SpeechBubbleLayerOptions {
  outlineColor: string;
  outlineWidthMm: number;
  textColor: string;
  fontId: string;
  fontSizePt: number;
  textFrame: { x: number; y: number; w: number; h: number };
}

export function assembleSpeechBubble(
  page: { activePageId: string; pageOrder: string[] },
  bodyShape: ShapeParams,
  tailShape: ShapeParams | null,
  options: SpeechBubbleLayerOptions,
): { root: Layer; layers: Layer[]; selectedId: string; label: string; textEditingId: string } {
  const body = createShapeLayer('吹き出し', bodyShape);
  const tail = tailShape ? createShapeLayer('しっぽ', tailShape) : null;
  const outline = createOutlineLayer('吹き出し枠');
  const frame = options.textFrame;
  const text = createTextLayer(
    '文字',
    newText(frame.x, frame.y, options.textColor, frame.w, frame.h, {
      fontId: options.fontId,
      sizePt: options.fontSizePt,
      direction: 'vertical',
      // 縦書きでは horizontalAlign が列の物理的な左右位置を表す。
      // 漫画の吹き出しは右側の列から読み始めるため、右寄せを既定にする。
      horizontalAlign: 'right',
      verticalAlign: 'top',
      lineHeight: 1.5,
    }),
  );
  body.childIds = [...(tail ? [tail.id] : []), outline.id, text.id];
  if (tail) {
    tail.parentId = body.id;
    tail.parameterLink = {
      source: { pageId: page.activePageId, layerId: body.id } satisfies LayerAddress,
      sourceNameHint: body.name,
      sourcePageIndexHint: Math.max(0, page.pageOrder.indexOf(page.activePageId)),
      linkedParameterIds: ['appearance.color'],
    };
  }
  outline.parentId = body.id;
  outline.state.outline = {
    ...outline.state.outline,
    color: options.outlineColor,
    widthMm: options.outlineWidthMm,
    cornerStyle: bodyShape.kind === 'rect' ? 'sharp' : 'round',
  };
  text.parentId = body.id;
  return {
    root: body,
    layers: [body, ...(tail ? [tail] : []), outline, text],
    selectedId: text.id,
    label: '吹き出しを追加',
    textEditingId: text.id,
  };
}
