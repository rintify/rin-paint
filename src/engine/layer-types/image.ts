import { cloneImageParams, normalizeImageParams, type ImageParams } from '../../model';
import { canvasToBlob, createImageLayer, makeCanvas, type ImageLayer } from '../layers';
import { imageFrameShape } from '../image/frame';
import { drawPlacedImage } from '../image/render';
import { shapeBounds } from '../shapes';
import type {
  LayerParameterLayer,
  LayerParameterValue,
  LayerTypeHandler,
} from './types';

function imageOf(layer: LayerParameterLayer): ImageParams {
  if (layer.type !== 'image' || !layer.image) throw new Error('Image parameter applied to a non-image layer');
  return layer.image;
}

const imageWrite = (make: (image: ImageParams, value: LayerParameterValue) => ImageParams) =>
  (layer: LayerParameterLayer, value: LayerParameterValue) => ({
    image: make(cloneImageParams(imageOf(layer)), value),
  });

function aspectLocked(layer: LayerParameterLayer): boolean {
  return layer.constrainAspect !== false;
}

async function canvasFromSource(source: { canvas?: HTMLCanvasElement; blob?: Blob }): Promise<HTMLCanvasElement | null> {
  if (source.canvas) return source.canvas;
  if (!source.blob) return null;
  const bitmap = await createImageBitmap(source.blob);
  const copy = makeCanvas(bitmap.width, bitmap.height);
  copy.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return copy;
}

/** 配置画像: 元画素を保持し、枠の位置・サイズ・回転で描く。操作は四角形と同じ。 */
export const imageLayerType: LayerTypeHandler<ImageLayer> = {
  type: 'image',
  canMask: true,
  maskSourceLabel: '画像',
  supportsBlend: true,

  defaultName: (index) => `画像 ${index}`,

  snapshot(layer, snapshot, env) {
    snapshot.image = cloneImageParams(layer.image);
    snapshot.snapEnabled = layer.snapEnabled;
    snapshot.constrainAspect = layer.constrainAspect;
    if (!env.withContent) return;
    const copy = makeCanvas(layer.canvas.width, layer.canvas.height);
    copy.getContext('2d')!.drawImage(layer.canvas, 0, 0);
    snapshot.canvas = copy;
    if (env.keepCanvas) return;
    void canvasToBlob(copy).then((blob) => {
      snapshot.blob = blob;
      snapshot.canvas = undefined;
      env.onEncoded();
    });
  },

  async restore(source, env) {
    if (!source.image) return null;
    const canvas = await canvasFromSource(source);
    if (!canvas) return null;
    return createImageLayer(
      env.name,
      canvas,
      source.image,
      source.id,
      source.snapEnabled !== false,
      source.constrainAspect !== false,
    );
  },

  async toSaved(layer) {
    return {
      image: cloneImageParams(layer.image),
      snapEnabled: layer.snapEnabled,
      constrainAspect: layer.constrainAspect,
      blob: await canvasToBlob(layer.canvas),
    };
  },

  applyProps(layer, props) {
    if (props.image !== undefined) layer.image = normalizeImageParams(cloneImageParams(props.image));
    if (props.snapEnabled !== undefined) layer.snapEnabled = props.snapEnabled;
    if (props.constrainAspect !== undefined) layer.constrainAspect = props.constrainAspect;
  },
  captureProps: (layer) => ({
    image: cloneImageParams(layer.image),
    snapEnabled: layer.snapEnabled,
    constrainAspect: layer.constrainAspect,
  }),

  scale(layer, factor) {
    layer.image = {
      ...layer.image,
      x: layer.image.x * factor,
      y: layer.image.y * factor,
      width: layer.image.width * factor,
      height: layer.image.height * factor,
    };
  },

  async scaleStored(source, env) {
    if (!source.image) return;
    source.image = {
      ...source.image,
      x: source.image.x * env.factor,
      y: source.image.y * env.factor,
      width: source.image.width * env.factor,
      height: source.image.height * env.factor,
    };
  },

  draw(ctx, layer) {
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blend;
    drawPlacedImage(ctx, layer.canvas, layer.image);
  },

  drawMask(ctx, layer) {
    drawPlacedImage(ctx, layer.canvas, layer.image);
  },

  bakeOnto(target, layer) {
    target.ctx.save();
    target.ctx.globalAlpha = layer.opacity;
    target.ctx.globalCompositeOperation = layer.blend;
    drawPlacedImage(target.ctx, layer.canvas, layer.image);
    target.ctx.restore();
  },

  objectTransform: {
    bounds: (layer) => shapeBounds(imageFrameShape(layer.image)),
    apply(layer, context) {
      const image = context.before.image;
      if (!image) return;
      const { transform, scale, angle } = context;
      const width = image.width * scale;
      const height = image.height * scale;
      const center = transform(image.x + image.width / 2, image.y + image.height / 2);
      layer.image = {
        x: center.x - width / 2,
        y: center.y - height / 2,
        width,
        height,
        rotation: image.rotation + angle,
      };
    },
  },

  contentCanvas: (layer) => layer.canvas,

  parameterDescriptors: () => [
    {
      key: 'snapEnabled', semanticId: 'interaction.snap', label: 'スナップ', control: 'switch',
      trueLabel: 'ON', falseLabel: 'OFF',
      read: layer => layer.type === 'image' ? layer.snapEnabled !== false : null,
      write: (_layer, value) => ({ snapEnabled: Boolean(value) }),
    },
    {
      key: 'constrainAspect', semanticId: 'transform.constrainAspect', label: '比率を維持', control: 'switch',
      trueLabel: 'ON', falseLabel: 'OFF',
      read: layer => layer.type === 'image' ? layer.constrainAspect !== false : null,
      write: (_layer, value) => ({ constrainAspect: Boolean(value) }),
    },
    { key: 'image.x', semanticId: 'frame.leftMm', label: 'X', control: 'number', canvasLength: true, read: layer => imageOf(layer).x, write: imageWrite((image, value) => ({ ...image, x: Number(value) })) },
    { key: 'image.y', semanticId: 'frame.topMm', label: 'Y', control: 'number', canvasLength: true, read: layer => imageOf(layer).y, write: imageWrite((image, value) => ({ ...image, y: Number(value) })) },
    {
      key: 'image.width', semanticId: 'frame.widthMm', label: '幅', control: 'number', canvasLength: true, min: 0.1,
      read: layer => imageOf(layer).width,
      write: (layer, value) => {
        const image = cloneImageParams(imageOf(layer));
        const width = Math.max(0.1, Number(value));
        if (!aspectLocked(layer)) return { image: { ...image, width } };
        return { image: { ...image, width, height: Math.max(0.1, width * (image.height / image.width)) } };
      },
    },
    {
      key: 'image.height', semanticId: 'frame.heightMm', label: '高さ', control: 'number', canvasLength: true, min: 0.1,
      read: layer => imageOf(layer).height,
      write: (layer, value) => {
        const image = cloneImageParams(imageOf(layer));
        const height = Math.max(0.1, Number(value));
        if (!aspectLocked(layer)) return { image: { ...image, height } };
        return { image: { ...image, height, width: Math.max(0.1, height * (image.width / image.height)) } };
      },
    },
    {
      key: 'rotation', semanticId: 'transform.rotation', label: '回転 (度)', control: 'number', min: -3600, max: 3600,
      read: layer => imageOf(layer).rotation * 180 / Math.PI,
      write: imageWrite((image, value) => ({ ...image, rotation: Number(value) * Math.PI / 180 })),
    },
  ],
};
