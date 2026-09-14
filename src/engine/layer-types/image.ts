import { drawProjectedProcedure } from '../geometry/drawProjectedProcedure';
import { layoutMatrixPixels, layoutBounds, readLayoutTransform } from '../geometry/layoutTransform';
import { inverse, multiply } from '../geometry/homography';
import { rasterToScope } from '../core/RasterCoordinates';
import { paintProjectedDrawing } from '../raster/paintProjectedDrawing';
import { cloneImageParams, normalizeImageParams, type ImageParams, type ImageState, type ShapeParams } from '../../model';
import { makeCanvas } from '../layers';
import { imageFrameShape, imageFromFrameShape } from '../image/frame';
import {ImageAsset} from '../image/ImageAsset';
import { shapeBounds } from '../shapes';
import { buildCatalog } from '../parameters/catalog';
import type { LayerDefinition } from './definition';

function cloneState(state: ImageState): ImageState {
  return {
    ...readLayoutTransform(state),
    placement: cloneImageParams(state.placement),
    snapEnabled: state.snapEnabled,
    constrainAspect: state.constrainAspect,
  };
}

function asImageState(value: unknown): ImageState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { placement?: ImageParams; snapEnabled?: unknown; constrainAspect?: unknown };
  const placement = record.placement;
  if (!placement || typeof placement !== 'object') return null;
  return {
    ...readLayoutTransform(value),
    placement: normalizeImageParams(cloneImageParams(placement)),
    snapEnabled: record.snapEnabled !== false,
    constrainAspect: record.constrainAspect !== false,
  };
}

async function canvasFromSource(source: Blob | undefined): Promise<HTMLCanvasElement | null> {
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
    defaultName: index => `画像 ${index}`,
  },
  state: {
    initial: () => ({ placement: { x: 0, y: 0, width: 1, height: 1, rotation: 0 }, snapEnabled: true, constrainAspect: true }),
    clone: cloneState,
    normalize: state => ({
      ...readLayoutTransform(state),
      placement: normalizeImageParams(cloneImageParams(state.placement)),
      snapEnabled: state.snapEnabled !== false,
      constrainAspect: state.constrainAspect !== false,
    }),
    applyPatch: (state, patch) => cloneState({
      ...state,
      ...patch,
      placement: patch.placement ? normalizeImageParams(cloneImageParams(patch.placement)) : state.placement,
    }),
    scale: (state, factor) => ({ ...cloneState(state), placement: scalePlacement(state.placement, factor) }),
  },
  codec: {
    encode: cloneState,
    decode: asImageState,
    encodeContent: layer => layer.runtime.asset.encode(),
    async decodeRuntime(content) {
      const canvas = await canvasFromSource(content);
      if (!canvas) return null;
      return {asset:new ImageAsset(canvas,content instanceof Blob ? content : undefined)};
    },

  },
  renderer: {
    draw(ctx, layer, env) {
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      const placement = scalePlacement(layer.state.placement, env.ppi / 25.4);
      drawProjectedProcedure(ctx, shapeBounds(imageFrameShape(placement)), layoutMatrixPixels(layer.state, env.ppi), source => layer.runtime.asset.draw(source, placement));
    },
    drawMask(ctx, layer, env) {
      const placement = scalePlacement(layer.state.placement, env.ppi / 25.4);
      drawProjectedProcedure(ctx, shapeBounds(imageFrameShape(placement)), layoutMatrixPixels(layer.state, env.ppi), source => layer.runtime.asset.draw(source, placement));
    },
    bakeOnto(target, layer, env) {
      const matrix = inverse(rasterToScope(target, env.ppi)); if (!matrix) return;
      const placement = scalePlacement(layer.state.placement, env.ppi / 25.4);
      const bounds = shapeBounds(imageFrameShape(placement));
      paintProjectedDrawing(target.runtime.surface, [bounds], multiply(matrix, layoutMatrixPixels(layer.state, env.ppi)), ctx => layer.runtime.asset.draw(ctx, placement), layer.opacity, layer.blend);
    },
    contentCanvas: layer => layer.runtime.asset.thumbnail(),
  },
  parameters: buildCatalog(
    [
      { id: 'interaction', label: '操作' },
      { id: 'transform', label: '変形' },
      { id: 'frame', label: '配置' },
    ],
    [
      {
        id: 'snapEnabled', semanticId: 'interaction.snap', groupId: 'interaction', label: 'スナップ',
        editor: { kind: 'switch', trueLabel: 'ON', falseLabel: 'OFF' }, surfaces: SURFACES,
        read: state => state.snapEnabled !== false,
        write: (state, value) => ({ ...cloneState(state), snapEnabled: Boolean(value) }),
      },
      {
        id: 'constrainAspect', semanticId: 'transform.constrainAspect', groupId: 'transform', label: '比率を維持',
        editor: { kind: 'switch', trueLabel: 'ON', falseLabel: 'OFF' }, surfaces: SURFACES,
        read: state => state.constrainAspect !== false,
        write: (state, value) => ({ ...cloneState(state), constrainAspect: Boolean(value) }),
      },
      {
        id: 'image.x', semanticId: 'frame.leftMm', groupId: 'frame', label: 'X',
        editor: { kind: 'number', unit: { kind: 'mm' } }, surfaces: SURFACES,
        read: state => state.placement.x,
        write: (state, value) => ({ ...cloneState(state), placement: { ...state.placement, x: Number(value) } }),
      },
      {
        id: 'image.y', semanticId: 'frame.topMm', groupId: 'frame', label: 'Y',
        editor: { kind: 'number', unit: { kind: 'mm' } }, surfaces: SURFACES,
        read: state => state.placement.y,
        write: (state, value) => ({ ...cloneState(state), placement: { ...state.placement, y: Number(value) } }),
      },
      {
        id: 'image.width', semanticId: 'frame.widthMm', groupId: 'frame', label: '幅',
        editor: { kind: 'number', min: 0.1, unit: { kind: 'mm' } }, surfaces: SURFACES,
        read: state => state.placement.width,
        write: (state, value) => {
          const width = Math.max(0.1, Number(value));
          const placement = cloneImageParams(state.placement);
          if (!state.constrainAspect) return { ...cloneState(state), placement: { ...placement, width } };
          return { ...cloneState(state), placement: { ...placement, width, height: Math.max(0.1, width * (placement.height / placement.width)) } };
        },
      },
      {
        id: 'image.height', semanticId: 'frame.heightMm', groupId: 'frame', label: '高さ',
        editor: { kind: 'number', min: 0.1, unit: { kind: 'mm' } }, surfaces: SURFACES,
        read: state => state.placement.height,
        write: (state, value) => {
          const height = Math.max(0.1, Number(value));
          const placement = cloneImageParams(state.placement);
          if (!state.constrainAspect) return { ...cloneState(state), placement: { ...placement, height } };
          return { ...cloneState(state), placement: { ...placement, height, width: Math.max(0.1, height * (placement.width / placement.height)) } };
        },
      },
      {
        id: 'rotation', semanticId: 'transform.rotation', groupId: 'transform', label: '回転',
        editor: { kind: 'number', min: -3600, max: 3600, unit: { kind: 'degree' } }, surfaces: SURFACES,
        read: state => state.placement.rotation * 180 / Math.PI,
        write: (state, value) => ({ ...cloneState(state), placement: { ...state.placement, rotation: Number(value) * Math.PI / 180 } }),
      },
    ],
  ),
  capabilities: {
    objectTransform: {
      bounds: (layer, env) => layoutBounds(layer.state, shapeBounds(imageFrameShape(scalePlacement(layer.state.placement, env.ppi / 25.4))), env.ppi),
      apply(layer, context) {
        const image = context.before.placement;
        const { transform, scale, angle } = context;
        const width = image.width * scale;
        const height = image.height * scale;
        const center = transform(image.x + image.width / 2, image.y + image.height / 2);
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
      toShape: layer => imageFrameShape(layer.state.placement),
      fromShape(layer, shape: ShapeParams) {
        if (shape.kind === 'rect') layer.state.placement = imageFromFrameShape(layer.state.placement, shape);
      },
      constrainAspect: layer => layer.state.constrainAspect !== false,
    },
    maskSource: {
      drawOpacity: layer => layer.opacity,
    },
    transferToRaster: {
      canTransfer: () => true,
    },
  },
};
