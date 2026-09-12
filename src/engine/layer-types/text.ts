import type { TextParams } from '../../model';
import { createTextLayer, type TextLayer } from '../layers';
import type { TextRenderer } from '../text/render';
import type {
  LayerParameterDescriptor,
  LayerParameterLayer,
  LayerParameterValue,
  LayerTypeHandler,
  ObjectBounds,
} from './types';

function textOf(layer: LayerParameterLayer): TextParams {
  if (layer.type !== 'text' || !layer.text) throw new Error('Text parameter applied to a non-text layer');
  return layer.text;
}

/**
 * 文字枠の実寸。幅・高さが自動 (null) のときは生成済みビットマップの実測値、
 * 未生成なら暫定値を使う。
 */
export function textFrame(layer: TextLayer, textRenderer: TextRenderer): ObjectBounds {
  const canvas = textRenderer.get(layer.id);
  const width = layer.text.width ?? Math.max(24, Number(canvas?.dataset.textWidth ?? 100));
  const height = layer.text.height ?? Math.max(24, Number(canvas?.dataset.textHeight ?? 60));
  return { x: layer.text.x, y: layer.text.y, w: width, h: height, width, height };
}

function scaleText(text: TextParams, factor: number): TextParams {
  return {
    ...text,
    x: text.x * factor,
    y: text.y * factor,
    width: text.width === null ? null : text.width * factor,
    height: text.height === null ? null : text.height * factor,
  };
}

function uniformTextStyle(text: TextParams, key: 'color' | 'fontId' | 'sizePt'): string | number | null {
  const values = [text.style[key], ...text.ranges.map(range => range[key])];
  return values.every(value => Object.is(value, values[0])) ? values[0] : null;
}

function rewriteTextStyle(text: TextParams, key: 'color' | 'fontId' | 'sizePt', value: string | number): TextParams {
  return {
    ...structuredClone(text),
    style: { ...text.style, [key]: value },
    ranges: text.ranges.map(range => ({ ...range, [key]: value })),
  } as TextParams;
}

const textWrite = (make: (text: TextParams, value: LayerParameterValue) => TextParams) =>
  (layer: LayerParameterLayer, value: LayerParameterValue) => ({ text: make(structuredClone(textOf(layer)), value) });

/** 文字レイヤー: TextRenderer が作るビットマップを枠に合わせて描く。 */
export const textLayerType: LayerTypeHandler<TextLayer> = {
  type: 'text',
  canMask: true,
  maskSourceLabel: '文字',
  supportsBlend: true,

  defaultName: () => '文字',

  snapshot(layer, snapshot) {
    snapshot.text = structuredClone(layer.text);
    snapshot.snapEnabled = layer.snapEnabled;
  },

  async restore(source, env) {
    if (!source.text) return null;
    return createTextLayer(env.name, {
      ...structuredClone(source.text),
      horizontalAlign: source.text.horizontalAlign ?? 'left',
      verticalAlign: source.text.verticalAlign ?? 'top',
      rotation: source.text.rotation ?? 0,
    }, source.id, source.snapEnabled !== false);
  },

  async toSaved(layer) {
    return { text: structuredClone(layer.text), snapEnabled: layer.snapEnabled };
  },

  applyProps(layer, props) {
    if (props.text !== undefined) layer.text = structuredClone(props.text);
    if (props.snapEnabled !== undefined) layer.snapEnabled = props.snapEnabled;
  },
  captureProps: (layer) => ({ text: structuredClone(layer.text), snapEnabled: layer.snapEnabled }),

  scale(layer, factor) {
    layer.text = scaleText(layer.text, factor);
  },

  async scaleStored(source, env) {
    if (source.text) source.text = scaleText(structuredClone(source.text), env.factor);
  },

  draw(ctx, layer, env) {
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blend;
    env.textRenderer.draw(ctx, layer.id, layer.text);
  },

  drawMask(ctx, layer, env) {
    env.textRenderer.draw(ctx, layer.id, layer.text);
  },

  bakeOnto(target, layer, env) {
    target.ctx.save();
    target.ctx.globalAlpha = layer.opacity;
    target.ctx.globalCompositeOperation = layer.blend;
    env.textRenderer.draw(target.ctx, layer.id, layer.text);
    target.ctx.restore();
  },

  objectTransform: {
    bounds: (layer, env) => textFrame(layer, env.textRenderer),
    apply(layer, context) {
      const text = context.before.text;
      if (!text) return;
      const { transform, scale, angle } = context;
      const width = context.width ?? text.width ?? 100;
      const height = context.height ?? text.height ?? 60;
      const center = transform(text.x + width / 2, text.y + height / 2);
      const nextWidth = width * scale, nextHeight = height * scale;
      layer.text = {
        ...structuredClone(text),
        x: center.x - nextWidth / 2,
        y: center.y - nextHeight / 2,
        width: text.width === null ? null : nextWidth,
        height: text.height === null ? null : nextHeight,
        rotation: (text.rotation ?? 0) + angle,
        style: { ...text.style, sizePt: text.style.sizePt * scale },
        ranges: text.ranges.map(range => ({ ...range, sizePt: range.sizePt * scale })),
      };
    },
  },

  contentCanvas: (layer, env) => env.textRenderer.get(layer.id),

  parameterDescriptors: (): LayerParameterDescriptor[] => [
    { key: 'snapEnabled', label: 'スナップ', control: 'switch', trueLabel: 'ON', falseLabel: 'OFF', read: layer => layer.type === 'text' ? layer.snapEnabled !== false : null, write: (_layer, value) => ({ snapEnabled: Boolean(value) }) },
    { key: 'color', label: '色', control: 'color', read: layer => uniformTextStyle(textOf(layer), 'color'), write: textWrite((text, value) => rewriteTextStyle(text, 'color', String(value))) },
    { key: 'rotation', label: '回転 (度)', control: 'number', min: -3600, max: 3600, read: layer => (textOf(layer).rotation ?? 0) * 180 / Math.PI, write: textWrite((text, value) => ({ ...text, rotation: Number(value) * Math.PI / 180 })) },
    { key: 'fontId', label: 'フォント', control: 'select', read: layer => uniformTextStyle(textOf(layer), 'fontId'), write: textWrite((text, value) => rewriteTextStyle(text, 'fontId', String(value))) },
    { key: 'fontSizePt', label: 'サイズ (pt)', control: 'number', min: 1, max: 512, read: layer => uniformTextStyle(textOf(layer), 'sizePt'), write: textWrite((text, value) => rewriteTextStyle(text, 'sizePt', Number(value))) },
    { key: 'text.direction', label: '文字全体の方向', control: 'select', options: [{ value: 'horizontal', label: '横書き' }, { value: 'vertical', label: '縦書き' }], read: layer => textOf(layer).direction, write: textWrite((text, value) => ({ ...text, direction: value as TextParams['direction'] })) },
    { key: 'text.horizontalAlign', label: '横位置', control: 'select', options: [{ value: 'left', label: '左揃え' }, { value: 'center', label: '中央揃え' }, { value: 'right', label: '右揃え' }], read: layer => textOf(layer).horizontalAlign ?? 'left', write: textWrite((text, value) => ({ ...text, horizontalAlign: value as TextParams['horizontalAlign'] })) },
    { key: 'text.verticalAlign', label: '縦位置', control: 'select', options: [{ value: 'top', label: '上揃え' }, { value: 'center', label: '中央揃え' }, { value: 'bottom', label: '下揃え' }], read: layer => textOf(layer).verticalAlign ?? 'top', write: textWrite((text, value) => ({ ...text, verticalAlign: value as TextParams['verticalAlign'] })) },
    { key: 'text.lineHeight', label: '行間 (倍)', control: 'number', min: 1, max: 5, read: layer => textOf(layer).lineHeight, write: textWrite((text, value) => ({ ...text, lineHeight: Number(value) })) },
  ],
};
