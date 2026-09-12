import { TRANSPARENT, type ShapePaintMode, type ShapeParams } from '../../model';
import { scaleShape } from '../canvasSpec';
import { createShapeLayer, type ShapeLayer } from '../layers';
import {
  cloneShape,
  drawShape,
  normalizeShape,
  setShapePaintMode,
  setShapeRotation,
  shapeBounds,
  shapeFillable,
  shapeKindLabel,
  shapePaintMode,
  shapeStrokeJoin,
  shapeParameterFields,
  shapeRotation,
  transformShape,
} from '../shapes';
import type {
  LayerParameterDescriptor,
  LayerParameterLayer,
  LayerParameterValue,
  LayerTypeHandler,
} from './types';

/** 図形の種類に応じた既定のレイヤー名 */
export function shapeLayerName(shape: ShapeParams): string {
  return shapeKindLabel(shape);
}

function shapeOf(layer: LayerParameterLayer): ShapeParams {
  if (layer.type !== 'shape' || !layer.shape) throw new Error('Shape parameter applied to a non-shape layer');
  return layer.shape;
}

function shapeDescriptors(shape: ShapeParams): LayerParameterDescriptor[] {
  const semanticForShapeKey = (key: string): string => ({
    'rect.x': 'frame.leftMm',
    'rect.y': 'frame.topMm',
    'rect.width': 'frame.widthMm',
    'rect.height': 'frame.heightMm',
    'ellipse.cx': 'object.centerXmm',
    'polygon.cx': 'object.centerXmm',
    'ellipse.cy': 'object.centerYmm',
    'polygon.cy': 'object.centerYmm',
  } as Record<string, string>)[key] ?? `shape.${key}`;
  const shapeRead = <T,>(read: (shape: ShapeParams) => T) =>
    (layer: LayerParameterLayer): T => read(shapeOf(layer));
  const shapeWrite = (make: (shape: ShapeParams, value: LayerParameterValue) => ShapeParams) =>
    (layer: LayerParameterLayer, value: LayerParameterValue) => ({
      shape: make(cloneShape(shapeOf(layer)), value),
    });
  const descriptors: LayerParameterDescriptor[] = [
    {
      key: 'snapEnabled', semanticId: 'interaction.snap', label: 'スナップ', control: 'switch',
      trueLabel: 'ON', falseLabel: 'OFF',
      read: layer => layer.type === 'shape' ? layer.snapEnabled !== false : null,
      write: (_layer, value) => ({ snapEnabled: Boolean(value) }),
    },
    {
      key: 'strokeWidth', semanticId: 'appearance.widthMm', label: '線の太さ', control: 'number', canvasLength: true,
      read: shapeRead(current => current.strokeWidth),
      write: shapeWrite((current, value) => ({ ...current, strokeWidth: Math.max(0, Number(value)) })),
    },
    {
      key: 'rotation', semanticId: 'transform.rotation', label: '回転 (度)', control: 'number', min: -3600, max: 3600,
      read: shapeRead(current => shapeRotation(current) * 180 / Math.PI),
      write: shapeWrite((current, value) => setShapeRotation(current, Number(value) * Math.PI / 180)),
    },
    {
      key: 'color', semanticId: 'appearance.color', label: '色', control: 'color', allowTransparent: true,
      read: shapeRead(current => current.color),
      write: shapeWrite((current, value) => ({ ...current, color: String(value) })),
    },
  ];
  if (shapeFillable(shape)) descriptors.push({
    key: 'paintMode', semanticId: 'shape.paintMode', label: '描画方式', control: 'select',
    options: [
      { value: 'stroke', label: '輪郭' },
      { value: 'fill-inside', label: '内側塗りつぶし' },
      { value: 'fill-outside', label: '外側塗りつぶし' },
    ],
    read: shapeRead(shapePaintMode),
    write: shapeWrite((current, value) => setShapePaintMode(current, value as ShapePaintMode)),
  });
  if (shape.kind === 'rect' || shape.kind === 'polygon') descriptors.push({
    key: 'strokeJoin', semanticId: 'appearance.cornerStyle', label: '線の角', control: 'select',
    options: [{ value: 'round', label: '丸' }, { value: 'miter', label: '角' }],
    read: shapeRead(shapeStrokeJoin),
    write: shapeWrite((current, value) => ({ ...current, strokeJoin: value === 'miter' || value === 'sharp' ? 'miter' : 'round' })),
    readCanonical: layer => shapeStrokeJoin(shapeOf(layer)) === 'miter' ? 'sharp' : 'round',
    writeCanonical: (layer, value) => ({ shape: { ...cloneShape(shapeOf(layer)), strokeJoin: value === 'sharp' ? 'miter' : 'round' } }),
  });
  if (shape.kind === 'rect' || shape.kind === 'polygon') descriptors.push({
    key: 'cornerRadius', semanticId: 'shape.cornerRadiusMm', label: '角丸半径', control: 'number', canvasLength: true, min: 0,
    read: shapeRead(current => current.kind === 'rect' || current.kind === 'polygon' ? current.cornerRadius ?? 0 : 0),
    write: shapeWrite((current, value) => current.kind === 'rect' || current.kind === 'polygon'
      ? { ...current, cornerRadius: Math.max(0, Number(value)) }
      : current),
  });
  descriptors.push(...shapeParameterFields(shape).map(field => ({
    key: field.key, semanticId: semanticForShapeKey(field.key), label: field.label, control: 'number' as const, min: field.min,
    canvasLength: field.canvasLength,
    read: shapeRead(current => field.read(current)),
    write: shapeWrite((current, value) => field.write(current, Number(value))),
  })));
  return descriptors;
}

/** 図形レイヤー: ベクターパラメータを毎フレーム描き直す。 */
export const shapeLayerType: LayerTypeHandler<ShapeLayer> = {
  type: 'shape',
  canMask: true,
  maskSourceLabel: '図形',
  supportsBlend: true,

  defaultName: () => '図形',

  snapshot(layer, snapshot) {
    snapshot.shape = cloneShape(layer.shape);
    snapshot.snapEnabled = layer.snapEnabled;
  },

  async restore(source, env) {
    if (!source.shape) return null;
    return createShapeLayer(env.name, normalizeShape(cloneShape(source.shape)), source.id, source.snapEnabled !== false);
  },

  async toSaved(layer) {
    return { shape: cloneShape(layer.shape), snapEnabled: layer.snapEnabled };
  },

  applyProps(layer, props) {
    if (props.shape !== undefined) layer.shape = cloneShape(props.shape);
    if (props.snapEnabled !== undefined) layer.snapEnabled = props.snapEnabled;
  },
  captureProps: (layer) => ({ shape: cloneShape(layer.shape), snapEnabled: layer.snapEnabled }),

  scale(layer, factor) {
    layer.shape = scaleShape(layer.shape, factor);
  },

  async scaleStored(source, env) {
    if (source.shape) source.shape = scaleShape(source.shape, env.factor);
  },

  draw(ctx, layer, env) {
    if (layer.shape.color === TRANSPARENT) return;
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blend;
    drawShape(ctx, layer.shape, undefined, env.artboard);
  },

  drawMask(ctx, layer, env) {
    if (layer.shape.color === TRANSPARENT) return;
    drawShape(ctx, { ...layer.shape, color: '#fff' }, false, env.artboard);
  },

  bakeOnto(target, layer, env) {
    target.ctx.save();
    target.ctx.globalAlpha = layer.opacity;
    target.ctx.globalCompositeOperation = layer.blend;
    drawShape(target.ctx, layer.shape, undefined, env.artboard);
    target.ctx.restore();
  },

  /** 透明色の図形は直親ラスターを非破壊で削る消しゴムとして働く */
  eraser: {
    applies: (layer) => layer.shape.color === TRANSPARENT,
    draw(ctx, layer, env) {
      ctx.globalAlpha = layer.opacity;
      drawShape(ctx, layer.shape, undefined, env.artboard);
    },
  },

  objectTransform: {
    bounds: (layer) => shapeBounds(layer.shape),
    apply(layer, context) {
      const shape = context.before.shape;
      if (!shape) return;
      const { transform, scale, angle } = context;
      layer.shape = transformShape(shape, { transform, scale, angle });
    },
  },

  contentCanvas: () => null,

  parameterDescriptors: (layer) => shapeDescriptors(shapeOf(layer)),
};
