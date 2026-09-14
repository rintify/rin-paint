import {
  cloneImageParams,
  defaultLayerCommon,
  normalizeImageParams,
  type ImageParams,
  type LayerCommon,
  type LayerKindMap,
  type LayerType,
  type ShapeParams,
  type TextParams,
} from '../model';
import { DEFAULT_ADJUST } from '../model/adjust';
import { DEFAULT_OUTLINE } from '../model/outline';
import { IDENTITY } from './geometry/homography';

export type LayerOf<K extends LayerType = LayerType> = LayerCommon & {
  type: K;
  state: LayerKindMap[K]['state'];
  runtime: LayerKindMap[K]['runtime'];
};

export type RasterLayer = LayerOf<'raster'>;
export type AdjustLayer = LayerOf<'adjust'>;
export type OutlineLayer = LayerOf<'outline'>;
export type ClipLayer = LayerOf<'clip'>;
export type ShapeLayer = LayerOf<'shape'>;
export type TextLayer = LayerOf<'text'>;
export type ImageLayer = LayerOf<'image'>;
export type CanvasLayer = LayerOf<'canvas'>;
export type TransformLayer = LayerOf<'transform'>;
export type Layer = { [K in LayerType]: LayerOf<K> }[LayerType];

let idCounter = 0;
export function newLayerId(): string {
  return `L${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

export function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function canvasRuntime(canvas: HTMLCanvasElement): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true })! };
}

export function createImageLayer(
  name: string,
  canvas: HTMLCanvasElement,
  image: ImageParams,
  id = newLayerId(),
  snapEnabled = true,
  constrainAspect = true,
): ImageLayer {
  return {
    ...defaultLayerCommon(id, name),
    type: 'image',
    state: {
      placement: normalizeImageParams(cloneImageParams(image)),
      snapEnabled,
      constrainAspect,
    },
    runtime: canvasRuntime(canvas),
  };
}

export function createTextLayer(name: string, text: TextParams, id = newLayerId(), snapEnabled = true): TextLayer {
  return {
    ...defaultLayerCommon(id, name),
    type: 'text',
    state: { text: structuredClone(text), snapEnabled },
    runtime: undefined,
  };
}

export function createRasterLayer(name: string, w: number, h: number, id = newLayerId(), deferred = false): RasterLayer {
  const runtime = canvasRuntime(makeCanvas(deferred ? 1 : w, deferred ? 1 : h));
  if (deferred) Object.assign(runtime, { deferred: true, logicalWidth: w, logicalHeight: h, contentBounds: null });
  return {
    ...defaultLayerCommon(id, name),
    type: 'raster',
    state: {},
    runtime,
  };
}

export function ensureRasterSurface(layer: RasterLayer): RasterLayer {
  if (!layer.runtime.deferred) return layer;
  const canvas = makeCanvas(layer.runtime.logicalWidth ?? layer.runtime.canvas.width, layer.runtime.logicalHeight ?? layer.runtime.canvas.height);
  layer.runtime = {
    ...canvasRuntime(canvas),
    deferred: false,
    logicalWidth: canvas.width,
    logicalHeight: canvas.height,
    contentBounds: layer.runtime.contentBounds ?? null,
  };
  return layer;
}

export function markRasterContent(layer: RasterLayer, rect: { x: number; y: number; w: number; h: number }): void {
  const limitWidth = layer.runtime.logicalWidth ?? layer.runtime.canvas.width;
  const limitHeight = layer.runtime.logicalHeight ?? layer.runtime.canvas.height;
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const clipped = {
    x,
    y,
    w: Math.max(0, Math.min(limitWidth, Math.ceil(rect.x + rect.w)) - x),
    h: Math.max(0, Math.min(limitHeight, Math.ceil(rect.y + rect.h)) - y),
  };
  const before = layer.runtime.contentBounds;
  if (before === undefined || clipped.w <= 0 || clipped.h <= 0) return;
  if (!before) layer.runtime.contentBounds = clipped;
  else {
    const right = Math.max(before.x + before.w, clipped.x + clipped.w);
    const bottom = Math.max(before.y + before.h, clipped.y + clipped.h);
    const x = Math.min(before.x, clipped.x), y = Math.min(before.y, clipped.y);
    layer.runtime.contentBounds = { x, y, w: right - x, h: bottom - y };
  }
}

export function createAdjustLayer(name: string, id = newLayerId()): AdjustLayer {
  return {
    ...defaultLayerCommon(id, name),
    type: 'adjust',
    state: { params: { ...DEFAULT_ADJUST }, maskLayerIds: [] },
    runtime: undefined,
  };
}

export function createOutlineLayer(name: string, id = newLayerId()): OutlineLayer {
  return {
    ...defaultLayerCommon(id, name),
    type: 'outline',
    state: { outline: { ...DEFAULT_OUTLINE } },
    runtime: undefined,
  };
}

export function createClipLayer(name: string, id = newLayerId()): ClipLayer {
  return {
    ...defaultLayerCommon(id, name),
    type: 'clip',
    state: { maskLayerIds: [] },
    runtime: undefined,
  };
}

export function createCanvasLayer(name: string, id = newLayerId()): CanvasLayer {
  return { ...defaultLayerCommon(id, name), type: 'canvas', state: { propagateTransforms: true }, runtime: undefined };
}

export function createTransformLayer(name: string, id = newLayerId()): TransformLayer {
  return { ...defaultLayerCommon(id, name), type: 'transform', state: { matrix: [...IDENTITY] }, runtime: undefined };
}

export function createShapeLayer(name: string, shape: ShapeParams, id = newLayerId(), snapEnabled = true): ShapeLayer {
  return {
    ...defaultLayerCommon(id, name),
    type: 'shape',
    state: { shape, snapEnabled },
    runtime: undefined,
  };
}

export function buildFilter(p: import('../model').AdjustParams): string {
  return `brightness(${p.brightness}%) contrast(${p.contrast}%) hue-rotate(${p.hue}deg) saturate(${p.saturation}%)`;
}
