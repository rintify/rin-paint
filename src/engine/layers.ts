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

export function createRasterLayer(name: string, w: number, h: number, id = newLayerId()): RasterLayer {
  return {
    ...defaultLayerCommon(id, name),
    type: 'raster',
    state: {},
    runtime: canvasRuntime(makeCanvas(w, h)),
  };
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
