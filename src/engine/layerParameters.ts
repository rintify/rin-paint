import { BLEND_OPTIONS, type BlendMode, type LayerMeta, type ShapeParams, type TextParams } from '../model';
import { cloneShape, shapeCenter } from './shapes';
import type { LayerProps } from './history/historyTree';
import type { Layer } from './layers';

export type LayerParameterValue = number | string | boolean;
export type LayerParameterLayer = Layer | LayerMeta;

export interface LayerParameterDescriptor {
  key: string;
  label: string;
  control: 'number' | 'color' | 'select' | 'switch';
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  allowTransparent?: boolean;
  read(layer: LayerParameterLayer): LayerParameterValue | null;
  write(layer: LayerParameterLayer, value: LayerParameterValue): LayerProps;
}

function shapeOf(layer: LayerParameterLayer): ShapeParams {
  if (layer.type !== 'shape' || !layer.shape) throw new Error('Shape parameter applied to a non-shape layer');
  return layer.shape;
}

function textOf(layer: LayerParameterLayer): TextParams {
  if (layer.type !== 'text' || !layer.text) throw new Error('Text parameter applied to a non-text layer');
  return layer.text;
}

function adjustOf(layer: LayerParameterLayer) {
  if (layer.type !== 'adjust' || !layer.params) throw new Error('Adjustment parameter applied to another layer');
  return layer.params;
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

function shapeDescriptors(shape: ShapeParams): LayerParameterDescriptor[] {
  const shapeRead = <T,>(read: (shape: ShapeParams) => T) =>
    (layer: LayerParameterLayer): T => read(shapeOf(layer));
  const shapeWrite = (make: (shape: ShapeParams, value: LayerParameterValue) => ShapeParams) =>
    (layer: LayerParameterLayer, value: LayerParameterValue): LayerProps => ({
      shape: make(cloneShape(shapeOf(layer)), value),
    });
  const descriptors: LayerParameterDescriptor[] = [
    {
      key: 'strokeWidth', label: '線の太さ', control: 'number', min: 1, max: 4096,
      read: shapeRead(current => current.strokeWidth),
      write: shapeWrite((current, value) => ({ ...current, strokeWidth: Math.max(1, Number(value)) })),
    },
    {
      key: 'rotation', label: '回転 (度)', control: 'number', min: -3600, max: 3600,
      read: shapeRead(current => {
        return (current.kind === 'line' ? Math.atan2(current.y2 - current.y1, current.x2 - current.x1) : current.rotation ?? 0) * 180 / Math.PI;
      }),
      write: shapeWrite((current, value) => {
        const angle = Number(value) * Math.PI / 180;
        if (current.kind !== 'line') return { ...current, rotation: angle };
        const center = shapeCenter(current), half = Math.hypot(current.x2 - current.x1, current.y2 - current.y1) / 2;
        const dx = half * Math.cos(angle), dy = half * Math.sin(angle);
        return { ...current, x1: center.x - dx, y1: center.y - dy, x2: center.x + dx, y2: center.y + dy };
      }),
    },
    {
      key: 'color', label: '色', control: 'color', allowTransparent: true,
      read: shapeRead(current => current.color),
      write: shapeWrite((current, value) => ({ ...current, color: String(value) })),
    },
  ];
  if (shape.kind !== 'line') descriptors.push({
    key: 'paintMode', label: '描画方式', control: 'select',
    options: [
      { value: 'stroke', label: '輪郭' },
      { value: 'fill-inside', label: '内側塗りつぶし' },
      { value: 'fill-outside', label: '外側塗りつぶし' },
    ],
    read: shapeRead(current => current.kind === 'line' ? 'stroke' : current.paintMode ?? 'stroke'),
    write: shapeWrite((current, value) => current.kind === 'line' ? current : { ...current, paintMode: value as 'stroke' | 'fill-inside' | 'fill-outside' }),
  });
  if (shape.kind === 'rect') descriptors.push(
    { key: 'rect.x', label: 'X', control: 'number', read: shapeRead(s => s.kind === 'rect' ? s.x : 0), write: shapeWrite((s, v) => s.kind === 'rect' ? { ...s, x: Number(v) } : s) },
    { key: 'rect.y', label: 'Y', control: 'number', read: shapeRead(s => s.kind === 'rect' ? s.y : 0), write: shapeWrite((s, v) => s.kind === 'rect' ? { ...s, y: Number(v) } : s) },
    { key: 'rect.width', label: '幅', control: 'number', min: .1, read: shapeRead(s => s.kind === 'rect' ? s.width : 0), write: shapeWrite((s, v) => s.kind === 'rect' ? { ...s, width: Math.max(.1, Number(v)) } : s) },
    { key: 'rect.height', label: '高さ', control: 'number', min: .1, read: shapeRead(s => s.kind === 'rect' ? s.height : 0), write: shapeWrite((s, v) => s.kind === 'rect' ? { ...s, height: Math.max(.1, Number(v)) } : s) },
  );
  if (shape.kind === 'ellipse') descriptors.push(
    { key: 'ellipse.cx', label: '中心 X', control: 'number', read: shapeRead(s => s.kind === 'ellipse' ? s.cx : 0), write: shapeWrite((s, v) => s.kind === 'ellipse' ? { ...s, cx: Number(v) } : s) },
    { key: 'ellipse.cy', label: '中心 Y', control: 'number', read: shapeRead(s => s.kind === 'ellipse' ? s.cy : 0), write: shapeWrite((s, v) => s.kind === 'ellipse' ? { ...s, cy: Number(v) } : s) },
    { key: 'ellipse.rx', label: '横半径', control: 'number', min: .1, read: shapeRead(s => s.kind === 'ellipse' ? s.rx : 0), write: shapeWrite((s, v) => s.kind === 'ellipse' ? { ...s, rx: Math.max(.1, Number(v)) } : s) },
    { key: 'ellipse.ry', label: '縦半径', control: 'number', min: .1, read: shapeRead(s => s.kind === 'ellipse' ? s.ry : 0), write: shapeWrite((s, v) => s.kind === 'ellipse' ? { ...s, ry: Math.max(.1, Number(v)) } : s) },
  );
  if (shape.kind === 'polygon') descriptors.push(
    { key: 'polygon.cx', label: '中心 X', control: 'number', read: shapeRead(s => s.kind === 'polygon' ? s.cx : 0), write: shapeWrite((s, v) => s.kind === 'polygon' ? { ...s, cx: Number(v) } : s) },
    { key: 'polygon.cy', label: '中心 Y', control: 'number', read: shapeRead(s => s.kind === 'polygon' ? s.cy : 0), write: shapeWrite((s, v) => s.kind === 'polygon' ? { ...s, cy: Number(v) } : s) },
  );
  if (shape.kind === 'line') descriptors.push(
    { key: 'line.x1', label: '開始 X', control: 'number', read: shapeRead(s => s.kind === 'line' ? s.x1 : 0), write: shapeWrite((s, v) => s.kind === 'line' ? { ...s, x1: Number(v) } : s) },
    { key: 'line.y1', label: '開始 Y', control: 'number', read: shapeRead(s => s.kind === 'line' ? s.y1 : 0), write: shapeWrite((s, v) => s.kind === 'line' ? { ...s, y1: Number(v) } : s) },
    { key: 'line.x2', label: '終了 X', control: 'number', read: shapeRead(s => s.kind === 'line' ? s.x2 : 0), write: shapeWrite((s, v) => s.kind === 'line' ? { ...s, x2: Number(v) } : s) },
    { key: 'line.y2', label: '終了 Y', control: 'number', read: shapeRead(s => s.kind === 'line' ? s.y2 : 0), write: shapeWrite((s, v) => s.kind === 'line' ? { ...s, y2: Number(v) } : s) },
  );
  return descriptors;
}

export function layerParameterDescriptors(layer: LayerParameterLayer): LayerParameterDescriptor[] {
  const result: LayerParameterDescriptor[] = [
    {
      key: 'visible', label: '表示', control: 'switch',
      read: value => value.visible,
      write: (_value, next) => ({ visible: Boolean(next) }),
    },
    {
      key: 'opacity', label: '不透明度', control: 'number', min: 0, max: 100,
      read: value => Math.round(value.opacity * 100),
      write: (_value, next) => ({ opacity: Math.max(0, Math.min(1, Number(next) / 100)) }),
    },
  ];
  if (layer.type !== 'adjust') result.push({
    key: 'blend', label: '合成', control: 'select',
    options: BLEND_OPTIONS.map(option => ({ ...option })),
    read: value => value.blend,
    write: (_value, next) => ({ blend: next as BlendMode }),
  });
  if (layer.type === 'adjust') {
    for (const [key, label, min, max] of [
      ['brightness', '明度', 0, 200], ['contrast', 'コントラスト', 0, 200],
      ['hue', '色相', -180, 180], ['saturation', '彩度', 0, 200],
    ] as const) result.push({
      key: `adjust.${key}`, label, control: 'number', min, max,
      read: value => adjustOf(value)[key],
      write: (value, next) => ({ params: { ...adjustOf(value), [key]: Number(next) } }),
    });
  } else if (layer.type === 'shape') result.push(...shapeDescriptors(shapeOf(layer)));
  else if (layer.type === 'text') {
    const textWrite = (make: (text: TextParams, value: LayerParameterValue) => TextParams) =>
      (value: LayerParameterLayer, next: LayerParameterValue): LayerProps => ({ text: make(structuredClone(textOf(value)), next) });
    result.push(
      { key: 'color', label: '色', control: 'color', read: value => uniformTextStyle(textOf(value), 'color'), write: textWrite((text, next) => rewriteTextStyle(text, 'color', String(next))) },
      { key: 'rotation', label: '回転 (度)', control: 'number', min: -3600, max: 3600, read: value => (textOf(value).rotation ?? 0) * 180 / Math.PI, write: textWrite((text, next) => ({ ...text, rotation: Number(next) * Math.PI / 180 })) },
      { key: 'fontId', label: 'フォント', control: 'select', read: value => uniformTextStyle(textOf(value), 'fontId'), write: textWrite((text, next) => rewriteTextStyle(text, 'fontId', String(next))) },
      { key: 'fontSizePt', label: 'サイズ (pt)', control: 'number', min: 1, max: 512, read: value => uniformTextStyle(textOf(value), 'sizePt'), write: textWrite((text, next) => rewriteTextStyle(text, 'sizePt', Number(next))) },
      { key: 'text.direction', label: '文字全体の方向', control: 'select', options: [{ value: 'horizontal', label: '横書き' }, { value: 'vertical', label: '縦書き' }], read: value => textOf(value).direction, write: textWrite((text, next) => ({ ...text, direction: next as TextParams['direction'] })) },
      { key: 'text.lineHeight', label: '行間 (倍)', control: 'number', min: 1, max: 5, read: value => textOf(value).lineHeight, write: textWrite((text, next) => ({ ...text, lineHeight: Number(next) })) },
    );
  }
  return result;
}

export function commonLayerParameterDescriptors(layers: LayerParameterLayer[]): LayerParameterDescriptor[] {
  if (!layers.length) return [];
  const maps = layers.map(layer => new Map(layerParameterDescriptors(layer).map(descriptor => [descriptor.key, descriptor])));
  return [...maps[0].values()]
    .filter(descriptor => maps.every(map => map.get(descriptor.key)?.control === descriptor.control))
    .map(descriptor => ({
      ...descriptor,
      allowTransparent: maps.every(map => map.get(descriptor.key)?.allowTransparent === true),
      read: layer => {
        const own = layerParameterDescriptors(layer).find(item => item.key === descriptor.key);
        return own ? own.read(layer) : null;
      },
      write: (layer, value) => {
        const own = layerParameterDescriptors(layer).find(item => item.key === descriptor.key);
        return own ? own.write(layer, value) : {};
      },
    }));
}
