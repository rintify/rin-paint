import {
  TRANSPARENT,
  type ShapePaintMode,
  type ShapeParams,
  type ShapeState,
} from '../../model';
import { scaleShape } from '../pageSpec';
import { createShapeLayer } from '../layers';
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
  shapeParameterFields,
  shapeRotation,
  shapeStrokeJoin,
  transformShape,
} from '../shapes';
import { buildCatalog, type ParameterCatalog } from '../parameters/catalog';
import type { ParameterDefinition } from '../parameters/types';
import type { LayerDefinition } from './definition';

export function shapeLayerName(shape: ShapeParams): string {
  return shapeKindLabel(shape);
}

function cloneState(state: ShapeState): ShapeState {
  return { shape: cloneShape(state.shape), snapEnabled: state.snapEnabled };
}

function asShapeState(value: unknown): ShapeState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { shape?: ShapeParams; snapEnabled?: unknown };
  if (!record.shape) return null;
  return {
    shape: normalizeShape(cloneShape(record.shape)),
    snapEnabled: record.snapEnabled !== false,
  };
}

const SURFACES = ['single', 'multi', 'link'] as const;
const catalogCache = new Map<
  ShapeParams['kind'],
  ParameterCatalog<ShapeState>
>();

function semanticForShapeKey(key: string): string {
  return (
    (
      {
        'rect.x': 'frame.leftMm',
        'rect.y': 'frame.topMm',
        'rect.width': 'frame.widthMm',
        'rect.height': 'frame.heightMm',
        'ellipse.cx': 'object.centerXmm',
        'polygon.cx': 'object.centerXmm',
        'ellipse.cy': 'object.centerYmm',
        'polygon.cy': 'object.centerYmm',
      } as Record<string, string>
    )[key] ?? `shape.${key}`
  );
}

function shapeCatalog(kind: ShapeParams['kind']): ParameterCatalog<ShapeState> {
  const cached = catalogCache.get(kind);
  if (cached) return cached;
  const sample: ShapeParams =
    kind === 'line'
      ? {
          kind: 'line',
          x1: 0,
          y1: 0,
          x2: 1,
          y2: 1,
          color: '#000',
          strokeWidth: 1,
        }
      : kind === 'ellipse'
        ? {
            kind: 'ellipse',
            cx: 0,
            cy: 0,
            rx: 1,
            ry: 1,
            color: '#000',
            strokeWidth: 1,
            paintMode: 'stroke',
          }
        : kind === 'polygon'
          ? {
              kind: 'polygon',
              cx: 0,
              cy: 0,
              points: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 0, y: 1 },
              ],
              color: '#000',
              strokeWidth: 1,
              paintMode: 'stroke',
            }
          : kind === 'bubble-tail'
            ? {
                kind: 'bubble-tail',
                style: 'pointed',
                start: { x: 0, y: 0 },
                control: { x: 1, y: 0 },
                tip: { x: 2, y: 0 },
                width: 1,
                circleCount: 3,
                spacingDecay: 0.35,
                color: '#000',
                strokeWidth: 0,
              }
            : {
                kind: 'rect',
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                color: '#000',
                strokeWidth: 1,
                paintMode: 'stroke',
              };
  const definitions: ParameterDefinition<ShapeState>[] = [
    {
      id: 'snapEnabled',
      semanticId: 'interaction.snap',
      groupId: 'interaction',
      label: 'スナップ',
      editor: { kind: 'switch', trueLabel: 'ON', falseLabel: 'OFF' },
      surfaces: SURFACES,
      read: (state) => state.snapEnabled !== false,
      write: (state, value) => ({
        ...cloneState(state),
        snapEnabled: Boolean(value),
      }),
    },
    {
      id: 'strokeWidth',
      semanticId: 'appearance.widthMm',
      groupId: 'appearance',
      label: '線の太さ',
      editor: { kind: 'slider', min: 0, max: 20, unit: { kind: 'canvas-mm' } },
      surfaces: SURFACES,
      read: (state) => state.shape.strokeWidth,
      write: (state, value) => ({
        ...cloneState(state),
        shape: { ...state.shape, strokeWidth: Math.max(0, Number(value)) },
      }),
    },
    {
      id: 'rotation',
      semanticId: 'transform.rotation',
      groupId: 'transform',
      label: '回転',
      editor: {
        kind: 'number',
        min: -3600,
        max: 3600,
        unit: { kind: 'degree' },
      },
      surfaces: SURFACES,
      read: (state) => (shapeRotation(state.shape) * 180) / Math.PI,
      write: (state, value) => ({
        ...cloneState(state),
        shape: setShapeRotation(
          cloneShape(state.shape),
          (Number(value) * Math.PI) / 180,
        ),
      }),
    },
    {
      id: 'color',
      semanticId: 'appearance.color',
      groupId: 'appearance',
      label: '色',
      editor: { kind: 'color', transparent: true },
      surfaces: SURFACES,
      read: (state) => state.shape.color,
      write: (state, value) => ({
        ...cloneState(state),
        shape: { ...state.shape, color: String(value) },
      }),
    },
  ];
  if (shapeFillable(sample))
    definitions.push({
      id: 'paintMode',
      semanticId: 'shape.paintMode',
      groupId: 'appearance',
      label: '描画方式',
      editor: {
        kind: 'select',
        options: {
          kind: 'static',
          options: [
            { value: 'stroke', label: '輪郭' },
            { value: 'fill-inside', label: '内側塗りつぶし' },
            { value: 'fill-outside', label: '外側塗りつぶし' },
          ],
        },
      },
      surfaces: SURFACES,
      read: (state) => shapePaintMode(state.shape),
      write: (state, value) => ({
        ...cloneState(state),
        shape: setShapePaintMode(
          cloneShape(state.shape),
          value as ShapePaintMode,
        ),
      }),
    });
  if (kind === 'rect' || kind === 'polygon') {
    definitions.push({
      id: 'strokeJoin',
      semanticId: 'appearance.cornerStyle',
      groupId: 'appearance',
      label: '線の角',
      editor: {
        kind: 'select',
        options: {
          kind: 'static',
          options: [
            { value: 'round', label: '丸' },
            { value: 'miter', label: '角' },
          ],
        },
      },
      surfaces: SURFACES,
      read: (state) => shapeStrokeJoin(state.shape),
      write: (state, value) => ({
        ...cloneState(state),
        shape: {
          ...cloneShape(state.shape),
          strokeJoin:
            value === 'miter' || value === 'sharp' ? 'miter' : 'round',
        },
      }),
      canonical: {
        toCanonical: (value) => (value === 'miter' ? 'sharp' : 'round'),
        fromCanonical: (value) => (value === 'sharp' ? 'miter' : 'round'),
      },
    });
    definitions.push({
      id: 'cornerRadius',
      semanticId: 'shape.cornerRadiusMm',
      groupId: 'appearance',
      label: '角丸半径',
      editor: { kind: 'number', min: 0, unit: { kind: 'canvas-mm' } },
      surfaces: SURFACES,
      read: (state) =>
        state.shape.kind === 'rect' || state.shape.kind === 'polygon'
          ? (state.shape.cornerRadius ?? 0)
          : 0,
      write: (state, value) => {
        const shape = cloneShape(state.shape);
        return {
          ...cloneState(state),
          shape:
            shape.kind === 'rect' || shape.kind === 'polygon'
              ? { ...shape, cornerRadius: Math.max(0, Number(value)) }
              : shape,
        };
      },
    });
  }
  if (kind === 'bubble-tail')
    definitions.push({
      id: 'tail.style',
      semanticId: 'tail.style',
      groupId: 'shape',
      label: 'しっぽの種類',
      editor: {
        kind: 'select',
        options: {
          kind: 'static',
          options: [
            { value: 'pointed', label: '普通' },
            { value: 'rounds', label: '丸' },
          ],
        },
      },
      surfaces: SURFACES,
      read: (state) =>
        state.shape.kind === 'bubble-tail' ? state.shape.style : 'pointed',
      write: (state, value) => {
        const shape = cloneShape(state.shape);
        return {
          ...cloneState(state),
          shape:
            shape.kind === 'bubble-tail'
              ? { ...shape, style: value === 'rounds' ? 'rounds' : 'pointed' }
              : shape,
        };
      },
    });
  definitions.push(
    ...shapeParameterFields(sample).map((field) => ({
      id: field.key,
      semanticId: semanticForShapeKey(field.key),
      groupId:
        field.key.startsWith('rect.') ||
        field.key.startsWith('ellipse.') ||
        field.key.startsWith('polygon.') ||
        field.key.startsWith('line.')
          ? 'frame'
          : 'shape',
      label: field.label,
      editor: {
        kind: 'number' as const,
        min: field.min,
        unit: field.canvasLength ? { kind: 'canvas-mm' as const } : undefined,
      },
      surfaces: SURFACES,
      read: (state: ShapeState) => field.read(state.shape),
      write: (
        state: ShapeState,
        value: import('../parameters/types').ParameterValue,
      ) => ({
        ...cloneState(state),
        shape: field.write(cloneShape(state.shape), Number(value)),
      }),
    })),
  );
  const catalog = buildCatalog(
    [
      { id: 'interaction', label: '操作' },
      { id: 'appearance', label: '見た目' },
      { id: 'transform', label: '変形' },
      { id: 'frame', label: '配置' },
      { id: 'shape', label: '図形' },
    ],
    definitions,
  );
  catalogCache.set(kind, catalog);
  return catalog;
}

export const shapeLayerType: LayerDefinition<'shape'> = {
  info: {
    type: 'shape',
    canMask: true,
    maskSourceLabel: '図形',
    supportsBlend: true,
    defaultName: () => '図形',
  },
  state: {
    initial: () =>
      createShapeLayer('tmp', {
        kind: 'rect',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        color: '#000',
        strokeWidth: 1,
        paintMode: 'stroke',
      }).state,
    clone: cloneState,
    normalize: (state) => ({
      shape: normalizeShape(cloneShape(state.shape)),
      snapEnabled: state.snapEnabled !== false,
    }),
    applyPatch: (state, patch) =>
      cloneState({
        ...state,
        ...patch,
        shape: patch.shape ? cloneShape(patch.shape) : state.shape,
      }),
    scale: (state, factor) => ({
      ...cloneState(state),
      shape: scaleShape(state.shape, factor),
    }),
  },
  codec: {
    encode: cloneState,
    decode: asShapeState,
    scaleStored(state, env) {
      const decoded = asShapeState(state);
      return decoded
        ? { ...decoded, shape: scaleShape(decoded.shape, env.factor) }
        : state;
    },
  },
  renderer: {
    draw(ctx, layer, env) {
      if (layer.state.shape.color === TRANSPARENT) return;
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      drawShape(ctx, layer.state.shape, undefined, env.artboard);
    },
    drawMask(ctx, layer, env) {
      if (layer.state.shape.color === TRANSPARENT) return;
      drawShape(
        ctx,
        { ...layer.state.shape, color: '#fff' },
        false,
        env.artboard,
      );
    },
    contentCanvas: () => null,
    eraser: {
      applies: (layer) => layer.state.shape.color === TRANSPARENT,
      draw(ctx, layer, env) {
        ctx.globalAlpha = layer.opacity;
        drawShape(ctx, layer.state.shape, undefined, env.artboard);
      },
    },
  },
  parameters: (layer) => shapeCatalog(layer.state.shape.kind),
  capabilities: {
    objectTransform: {
      bounds: (layer) => shapeBounds(layer.state.shape),
      apply(layer, context) {
        layer.state.shape = transformShape(context.before.shape, {
          transform: context.transform,
          scale: context.scale,
          angle: context.angle,
        });
      },
    },
    frameEdit: {
      toShape: (layer) => cloneShape(layer.state.shape),
      fromShape(layer, shape) {
        layer.state.shape = cloneShape(shape);
      },
    },
    vertexEdit: {
      enabled: (layer) => layer.state.shape.kind === 'polygon',
    },
    maskSource: {
      drawOpacity: (layer) => layer.opacity,
    },
    transferToRaster: {
      canTransfer: (layer) => layer.childIds.length === 0 && !!layer.parentId,
    },
  },
};
