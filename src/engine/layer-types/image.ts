import {
  cloneImageParams,
  normalizeImageParams,
  type ImageParams,
  type ImageState,
  type ShapeParams,
} from '../../model';
import { canvasToBlob, makeCanvas } from '../layers';
import { imageFrameShape, imageFromFrameShape } from '../image/frame';
import { drawPlacedImage } from '../image/render';
import { shapeBounds } from '../shapes';
import { buildCatalog } from '../parameters/catalog';
import type { LayerDefinition } from './definition';

function cloneState(state: ImageState): ImageState {
  return {
    placement: cloneImageParams(state.placement),
    snapEnabled: state.snapEnabled,
    constrainAspect: state.constrainAspect,
  };
}

function asImageState(value: unknown): ImageState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as {
    placement?: ImageParams;
    image?: ImageParams;
    snapEnabled?: unknown;
    constrainAspect?: unknown;
  };
  const placement = record.placement ?? record.image;
  if (!placement || typeof placement !== 'object') return null;
  return {
    placement: normalizeImageParams(cloneImageParams(placement)),
    snapEnabled: record.snapEnabled !== false,
    constrainAspect: record.constrainAspect !== false,
  };
}

async function canvasFromSource(
  source: HTMLCanvasElement | Blob | undefined,
): Promise<HTMLCanvasElement | null> {
  if (
    source &&
    typeof source === 'object' &&
    'getContext' in source &&
    typeof (source as HTMLCanvasElement).getContext === 'function'
  ) {
    return source as HTMLCanvasElement;
  }
  if (!source) return null;
  const bitmap = await createImageBitmap(source);
  const copy = makeCanvas(bitmap.width, bitmap.height);
  copy.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return copy;
}

function scalePlacement(placement: ImageParams, factor: number): ImageParams {
  return {
    ...placement,
    x: placement.x * factor,
    y: placement.y * factor,
    width: placement.width * factor,
    height: placement.height * factor,
  };
}

const SURFACES = ['single', 'multi', 'link'] as const;

export const imageLayerType: LayerDefinition<'image'> = {
  info: {
    type: 'image',
    canMask: true,
    maskSourceLabel: '画像',
    supportsBlend: true,
    defaultName: (index) => `画像 ${index}`,
  },
  state: {
    initial: () => ({
      placement: { x: 0, y: 0, width: 1, height: 1, rotation: 0 },
      snapEnabled: true,
      constrainAspect: true,
    }),
    clone: cloneState,
    normalize: (state) => ({
      placement: normalizeImageParams(cloneImageParams(state.placement)),
      snapEnabled: state.snapEnabled !== false,
      constrainAspect: state.constrainAspect !== false,
    }),
    applyPatch: (state, patch) =>
      cloneState({
        ...state,
        ...patch,
        placement: patch.placement
          ? normalizeImageParams(cloneImageParams(patch.placement))
          : state.placement,
      }),
    scale: (state, factor) => ({
      ...cloneState(state),
      placement: scalePlacement(state.placement, factor),
    }),
  },
  codec: {
    encode: cloneState,
    decode: asImageState,
    encodeContent: (layer) => canvasToBlob(layer.runtime.canvas),
    async decodeRuntime(content) {
      const canvas = await canvasFromSource(
        content instanceof Blob || (content && 'getContext' in content)
          ? (content as Blob | HTMLCanvasElement)
          : undefined,
      );
      if (!canvas) return null;
      return {
        canvas,
        ctx: canvas.getContext('2d', { willReadFrequently: true })!,
      };
    },
    scaleStored(state, env) {
      const decoded = asImageState(state);
      return decoded
        ? {
            ...decoded,
            placement: scalePlacement(decoded.placement, env.factor),
          }
        : state;
    },
  },
  renderer: {
    draw(ctx, layer) {
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      drawPlacedImage(ctx, layer.runtime.canvas, layer.state.placement);
    },
    drawMask(ctx, layer) {
      drawPlacedImage(ctx, layer.runtime.canvas, layer.state.placement);
    },
    contentCanvas: (layer) => layer.runtime.canvas,
  },
  parameters: buildCatalog(
    [
      { id: 'interaction', label: '操作' },
      { id: 'transform', label: '変形' },
      { id: 'frame', label: '配置' },
    ],
    [
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
        id: 'constrainAspect',
        semanticId: 'transform.constrainAspect',
        groupId: 'transform',
        label: '比率を維持',
        editor: { kind: 'switch', trueLabel: 'ON', falseLabel: 'OFF' },
        surfaces: SURFACES,
        read: (state) => state.constrainAspect !== false,
        write: (state, value) => ({
          ...cloneState(state),
          constrainAspect: Boolean(value),
        }),
      },
      {
        id: 'image.x',
        semanticId: 'frame.leftMm',
        groupId: 'frame',
        label: 'X',
        editor: { kind: 'number', unit: { kind: 'canvas-mm' } },
        surfaces: SURFACES,
        read: (state) => state.placement.x,
        write: (state, value) => ({
          ...cloneState(state),
          placement: { ...state.placement, x: Number(value) },
        }),
      },
      {
        id: 'image.y',
        semanticId: 'frame.topMm',
        groupId: 'frame',
        label: 'Y',
        editor: { kind: 'number', unit: { kind: 'canvas-mm' } },
        surfaces: SURFACES,
        read: (state) => state.placement.y,
        write: (state, value) => ({
          ...cloneState(state),
          placement: { ...state.placement, y: Number(value) },
        }),
      },
      {
        id: 'image.width',
        semanticId: 'frame.widthMm',
        groupId: 'frame',
        label: '幅',
        editor: { kind: 'number', min: 0.1, unit: { kind: 'canvas-mm' } },
        surfaces: SURFACES,
        read: (state) => state.placement.width,
        write: (state, value) => {
          const width = Math.max(0.1, Number(value));
          const placement = cloneImageParams(state.placement);
          if (!state.constrainAspect)
            return { ...cloneState(state), placement: { ...placement, width } };
          return {
            ...cloneState(state),
            placement: {
              ...placement,
              width,
              height: Math.max(
                0.1,
                width * (placement.height / placement.width),
              ),
            },
          };
        },
      },
      {
        id: 'image.height',
        semanticId: 'frame.heightMm',
        groupId: 'frame',
        label: '高さ',
        editor: { kind: 'number', min: 0.1, unit: { kind: 'canvas-mm' } },
        surfaces: SURFACES,
        read: (state) => state.placement.height,
        write: (state, value) => {
          const height = Math.max(0.1, Number(value));
          const placement = cloneImageParams(state.placement);
          if (!state.constrainAspect)
            return {
              ...cloneState(state),
              placement: { ...placement, height },
            };
          return {
            ...cloneState(state),
            placement: {
              ...placement,
              height,
              width: Math.max(
                0.1,
                height * (placement.width / placement.height),
              ),
            },
          };
        },
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
        read: (state) => (state.placement.rotation * 180) / Math.PI,
        write: (state, value) => ({
          ...cloneState(state),
          placement: {
            ...state.placement,
            rotation: (Number(value) * Math.PI) / 180,
          },
        }),
      },
    ],
  ),
  capabilities: {
    objectTransform: {
      bounds: (layer) => shapeBounds(imageFrameShape(layer.state.placement)),
      apply(layer, context) {
        const image = context.before.placement;
        const { transform, scale, angle } = context;
        const width = image.width * scale;
        const height = image.height * scale;
        const center = transform(
          image.x + image.width / 2,
          image.y + image.height / 2,
        );
        layer.state.placement = {
          x: center.x - width / 2,
          y: center.y - height / 2,
          width,
          height,
          rotation: image.rotation + angle,
        };
      },
    },
    frameEdit: {
      toShape: (layer) => imageFrameShape(layer.state.placement),
      fromShape(layer, shape: ShapeParams) {
        if (shape.kind === 'rect')
          layer.state.placement = imageFromFrameShape(
            layer.state.placement,
            shape,
          );
      },
      constrainAspect: (layer) => layer.state.constrainAspect !== false,
    },
    maskSource: {
      drawOpacity: (layer) => layer.opacity,
    },
    transferToRaster: {
      canTransfer: (layer) => layer.childIds.length === 0 && !!layer.parentId,
    },
  },
};
