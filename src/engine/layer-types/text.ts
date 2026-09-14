import { drawProjectedProcedure } from '../geometry/drawProjectedProcedure';
import { layoutMatrixPixels, layoutBounds, readLayoutTransform } from '../geometry/layoutTransform';
import { inverse, multiply } from '../geometry/homography';
import { rasterToScope } from '../core/RasterCoordinates';
import { paintProjectedDrawing } from '../raster/paintProjectedDrawing';
import type { TextParams, TextState } from '../../model';
import { createTextLayer } from '../layers';
import { rotatedRectBounds } from '../shapes/snap';
import type { TextRenderer } from '../text/render';
import { buildCatalog } from '../parameters/catalog';
import type { LayerDefinition } from './definition';
import type { ObjectBounds } from './types';
import type { TextLayer } from '../layers';

function textOf(state: TextState): TextParams {
  return state.text;
}

export function textFrame(layer: TextLayer, textRenderer: TextRenderer, ppi = 25.4): ObjectBounds {
  const canvas = textRenderer.get(layer.id);
  const text = scaleText(layer.state.text, ppi / 25.4);
  const width = text.width ?? Math.max(24, Number(canvas?.dataset.textWidth ?? 100));
  const height = text.height ?? Math.max(24, Number(canvas?.dataset.textHeight ?? 60));
  return { x: text.x, y: text.y, w: width, h: height, width, height };
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

function cloneState(state: TextState): TextState {
  return { ...readLayoutTransform(state), text: structuredClone(state.text), snapEnabled: state.snapEnabled };
}

function asTextState(value: unknown): TextState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { text?: TextParams; snapEnabled?: unknown };
  if (!record.text) return null;
  return {
    ...readLayoutTransform(value),
    text: {
      ...structuredClone(record.text),
      horizontalAlign: record.text.horizontalAlign ?? 'left',
      verticalAlign: record.text.verticalAlign ?? 'top',
      rotation: record.text.rotation ?? 0,
    },
    snapEnabled: record.snapEnabled !== false,
  };
}

function uniformTextStyle(text: TextParams, key: 'color' | 'fontId' | 'sizeMm'): string | number | null {
  const values = [text.style[key], ...text.ranges.map(range => range[key])];
  return values.every(value => Object.is(value, values[0])) ? values[0] : null;
}

function rewriteTextStyle(text: TextParams, key: 'color' | 'fontId' | 'sizeMm', value: string | number): TextParams {
  return {
    ...structuredClone(text),
    style: { ...text.style, [key]: value },
    ranges: text.ranges.map(range => ({ ...range, [key]: value })),
  } as TextParams;
}

const SURFACES = ['single', 'multi', 'link'] as const;
const MULTI = ['multi'] as const;

export const textLayerType: LayerDefinition<'text'> = {
  info: {
    type: 'text',
    canMask: true,
    maskSourceLabel: '文字',
    supportsBlend: true,
    defaultName: () => '文字',
  },
  state: {
    initial: () => createTextLayer('tmp', {
      content: '', x: 0, y: 0, width: null, height: null, rotation: 0, direction: 'horizontal',
      horizontalAlign: 'left', verticalAlign: 'top', lineHeight: 1.5,
      style: { fontId: 'sans', color: '#000000', sizeMm: 12 * 25.4 / 72 }, ranges: [], ruby: [],
    }).state,
    clone: cloneState,
    normalize: state => asTextState(state) ?? cloneState(state),
    applyPatch: (state, patch) => cloneState({
      ...state,
      ...patch,
      text: patch.text ? structuredClone(patch.text) : state.text,
    }),
    scale: (state, factor) => ({ ...cloneState(state), text: scaleText(state.text, factor) }),
  },
  codec: {
    encode: cloneState,
    decode: asTextState,

  },
  renderer: {
    draw(ctx, layer, env) {
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      const text = scaleText(layer.state.text, env.ppi / 25.4);
      drawProjectedProcedure(ctx, rotatedRectBounds(textFrame(layer, env.textRenderer, env.ppi), text.rotation ?? 0), layoutMatrixPixels(layer.state, env.ppi), source => env.textRenderer.draw(source, layer.id, text));
    },
    drawMask(ctx, layer, env) {
      const text = scaleText(layer.state.text, env.ppi / 25.4);
      drawProjectedProcedure(ctx, rotatedRectBounds(textFrame(layer, env.textRenderer, env.ppi), text.rotation ?? 0), layoutMatrixPixels(layer.state, env.ppi), source => env.textRenderer.draw(source, layer.id, text));
    },
    bakeOnto(target, layer, env) {
      const matrix = inverse(rasterToScope(target, env.ppi)); if (!matrix) return;
      const text = scaleText(layer.state.text, env.ppi / 25.4);
      const bounds = rotatedRectBounds(textFrame(layer, env.textRenderer, env.ppi), text.rotation ?? 0);
      paintProjectedDrawing(target.runtime.surface, [bounds], multiply(matrix, layoutMatrixPixels(layer.state, env.ppi)), ctx => env.textRenderer.draw(ctx, layer.id, text), layer.opacity, layer.blend);
    },
    contentCanvas: (layer, env) => env.textRenderer.get(layer.id),
  },
  parameters: buildCatalog(
    [
      { id: 'interaction', label: '操作' },
      { id: 'frame', label: '配置' },
      { id: 'transform', label: '変形' },
      { id: 'text', label: '文字' },
      { id: 'appearance', label: '見た目' },
    ],
    [
      {
        id: 'snapEnabled', semanticId: 'interaction.snap', groupId: 'interaction', label: 'スナップ',
        editor: { kind: 'switch', trueLabel: 'ON', falseLabel: 'OFF' }, surfaces: SURFACES,
        read: state => state.snapEnabled !== false,
        write: (state, value) => ({ ...cloneState(state), snapEnabled: Boolean(value) }),
      },
      {
        id: 'text.x', semanticId: 'frame.leftMm', groupId: 'frame', label: 'X',
        editor: { kind: 'number', unit: { kind: 'mm' } }, surfaces: SURFACES,
        read: state => textOf(state).x,
        write: (state, value) => ({ ...cloneState(state), text: { ...state.text, x: Number(value) } }),
      },
      {
        id: 'text.y', semanticId: 'frame.topMm', groupId: 'frame', label: 'Y',
        editor: { kind: 'number', unit: { kind: 'mm' } }, surfaces: SURFACES,
        read: state => textOf(state).y,
        write: (state, value) => ({ ...cloneState(state), text: { ...state.text, y: Number(value) } }),
      },
      {
        id: 'text.width', semanticId: 'frame.widthMm', groupId: 'frame', label: '枠幅',
        editor: { kind: 'number', unit: { kind: 'mm' }, nullable: true }, surfaces: SURFACES,
        read: state => textOf(state).width,
        write: (state, value) => ({ ...cloneState(state), text: { ...state.text, width: value === null ? null : Number(value) } }),
      },
      {
        id: 'text.height', semanticId: 'frame.heightMm', groupId: 'frame', label: '枠高さ',
        editor: { kind: 'number', unit: { kind: 'mm' }, nullable: true }, surfaces: SURFACES,
        read: state => textOf(state).height,
        write: (state, value) => ({ ...cloneState(state), text: { ...state.text, height: value === null ? null : Number(value) } }),
      },
      {
        id: 'color', semanticId: 'appearance.color', groupId: 'appearance', label: '色',
        editor: { kind: 'color', transparent: false }, surfaces: MULTI,
        read: state => uniformTextStyle(textOf(state), 'color'),
        write: (state, value) => typeof value === 'string'
          ? { ...cloneState(state), text: rewriteTextStyle(state.text, 'color', value) }
          : cloneState(state),
      },
      {
        id: 'rotation', semanticId: 'transform.rotation', groupId: 'transform', label: '回転',
        editor: { kind: 'number', min: -3600, max: 3600, unit: { kind: 'degree' } }, surfaces: SURFACES,
        read: state => (textOf(state).rotation ?? 0) * 180 / Math.PI,
        write: (state, value) => ({ ...cloneState(state), text: { ...state.text, rotation: Number(value) * Math.PI / 180 } }),
      },
      {
        id: 'fontId', semanticId: 'text.fontId', groupId: 'text', label: 'フォント',
        editor: { kind: 'select', options: { kind: 'project-fonts' } }, surfaces: MULTI,
        read: state => uniformTextStyle(textOf(state), 'fontId'),
        write: (state, value) => typeof value === 'string'
          ? { ...cloneState(state), text: rewriteTextStyle(state.text, 'fontId', value) }
          : cloneState(state),
      },
      {
        id: 'fontSizePt', semanticId: 'text.fontSizeMm',
        canonical: {toCanonical: value => typeof value === 'number' ? value * 25.4 / 72 : value, fromCanonical: value => typeof value === 'number' ? value * 72 / 25.4 : value}, groupId: 'text', label: 'サイズ',
        editor: { kind: 'number', min: 1, max: 512, unit: { kind: 'pt' } }, surfaces: MULTI,
        read: state => {const value = uniformTextStyle(textOf(state), 'sizeMm'); return typeof value === 'number' ? value * 72 / 25.4 : value;},
        write: (state, value) => ({ ...cloneState(state), text: rewriteTextStyle(state.text, 'sizeMm', Number(value) * 25.4 / 72) }),
      },
      {
        id: 'text.direction', semanticId: 'text.direction', groupId: 'text', label: '文字全体の方向',
        editor: { kind: 'select', options: { kind: 'static', options: [{ value: 'horizontal', label: '横書き' }, { value: 'vertical', label: '縦書き' }] } },
        surfaces: SURFACES,
        read: state => textOf(state).direction,
        write: (state, value) => ({ ...cloneState(state), text: { ...state.text, direction: value as TextParams['direction'] } }),
      },
      {
        id: 'text.horizontalAlign', semanticId: 'text.horizontalAlign', groupId: 'text', label: '横位置',
        editor: { kind: 'select', options: { kind: 'static', options: [{ value: 'left', label: '左揃え' }, { value: 'center', label: '中央揃え' }, { value: 'right', label: '右揃え' }] } },
        surfaces: SURFACES,
        read: state => textOf(state).horizontalAlign ?? 'left',
        write: (state, value) => ({ ...cloneState(state), text: { ...state.text, horizontalAlign: value as TextParams['horizontalAlign'] } }),
      },
      {
        id: 'text.verticalAlign', semanticId: 'text.verticalAlign', groupId: 'text', label: '縦位置',
        editor: { kind: 'select', options: { kind: 'static', options: [{ value: 'top', label: '上揃え' }, { value: 'center', label: '中央揃え' }, { value: 'bottom', label: '下揃え' }] } },
        surfaces: SURFACES,
        read: state => textOf(state).verticalAlign ?? 'top',
        write: (state, value) => ({ ...cloneState(state), text: { ...state.text, verticalAlign: value as TextParams['verticalAlign'] } }),
      },
      {
        id: 'text.lineHeight', semanticId: 'text.lineHeight', groupId: 'text', label: '行間',
        editor: { kind: 'number', min: 1, max: 5, unit: { kind: 'none', suffix: '倍' } }, surfaces: SURFACES,
        read: state => textOf(state).lineHeight,
        write: (state, value) => ({ ...cloneState(state), text: { ...state.text, lineHeight: Number(value) } }),
      },
    ],
  ),
  capabilities: {
    objectTransform: {
      bounds(layer, env) {
        const bounds = textFrame(layer, env.textRenderer, env.ppi);
        const projected = layoutBounds(layer.state, rotatedRectBounds(bounds, layer.state.text.rotation ?? 0), env.ppi);
        return projected ? {...projected, width: bounds.width, height: bounds.height} : null;
      },
      apply(layer, context) {
        const text = context.before.text;
        const { transform, scale, angle } = context;
        const width = context.width ?? text.width ?? 100;
        const height = context.height ?? text.height ?? 60;
        const center = transform(text.x + width / 2, text.y + height / 2);
        const nextWidth = width * scale, nextHeight = height * scale;
        layer.state.text = {
          ...structuredClone(text),
          x: center.x - nextWidth / 2,
          y: center.y - nextHeight / 2,
          width: text.width === null ? null : nextWidth,
          height: text.height === null ? null : nextHeight,
          rotation: (text.rotation ?? 0) + angle,
          style: { ...text.style, sizeMm: text.style.sizeMm * scale },
          ranges: text.ranges.map(range => ({ ...range, sizeMm: range.sizeMm * scale })),
        };
      },
    },
    maskSource: {
      drawOpacity: layer => layer.opacity,
    },
    renderLifecycle: {
      prepare(layer, env, onReady) {
        env.textRenderer.request(layer.id, scaleText(layer.state.text, env.ppi / 25.4), env.ppi, onReady ?? (() => undefined));
      },
    },
  },
};
