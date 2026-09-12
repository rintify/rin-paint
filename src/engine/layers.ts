import { DEFAULT_ADJUST, type AdjustParams } from '../model/adjust';
import type { BlendMode } from '../model/blend';
import { cloneImageParams, normalizeImageParams, type ImageParams } from '../model/image';
import { DEFAULT_OUTLINE, type OutlineParams } from '../model/outline';
import type { ShapeParams } from '../model/shape';
import type { TextParams } from '../model/text';
import type { LayerParameterLink } from '../model/layer';

interface LayerTreeFields {
  parentId: string | null;
  childIds: string[];
  parameterLink?: LayerParameterLink;
}

export interface RasterLayer extends LayerTreeFields {
  id: string;
  type: 'raster';
  name: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
}

export interface AdjustLayer extends LayerTreeFields {
  id: string;
  type: 'adjust';
  name: string;
  params: AdjustParams;
  maskLayerIds: string[];
  opacity: number;
  blend: BlendMode;
  visible: boolean;
}

export interface OutlineLayer extends LayerTreeFields {
  id: string;
  type: 'outline';
  name: string;
  outline: OutlineParams;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
}

export interface ClipLayer extends LayerTreeFields {
  id: string;
  type: 'clip';
  name: string;
  maskLayerIds: string[];
  opacity: number;
  blend: BlendMode;
  visible: boolean;
}

export interface ShapeLayer extends LayerTreeFields {
  id: string;
  type: 'shape';
  name: string;
  shape: ShapeParams;
  snapEnabled: boolean;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
}

export interface TextLayer extends LayerTreeFields {
  id: string;
  type: 'text';
  name: string;
  text: TextParams;
  snapEnabled: boolean;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
}

export interface ImageLayer extends LayerTreeFields {
  id: string;
  type: 'image';
  name: string;
  image: ImageParams;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  snapEnabled: boolean;
  constrainAspect: boolean;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
}
export type Layer = RasterLayer | AdjustLayer | OutlineLayer | ClipLayer | ShapeLayer | TextLayer | ImageLayer;

export function createImageLayer(
  name: string,
  canvas: HTMLCanvasElement,
  image: ImageParams,
  id = newLayerId(),
  snapEnabled = true,
  constrainAspect = true,
): ImageLayer {
  return {
    id,
    type: 'image',
    name,
    image: normalizeImageParams(cloneImageParams(image)),
    canvas,
    ctx: canvas.getContext('2d', { willReadFrequently: true })!,
    snapEnabled,
    constrainAspect,
    opacity: 1,
    blend: 'source-over',
    visible: true,
    parentId: null,
    childIds: [],
  };
}

export function createTextLayer(name: string, text: TextParams, id = newLayerId(), snapEnabled = true): TextLayer {
  return {
    id,
    type: 'text',
    name,
    text: structuredClone(text),
    snapEnabled,
    opacity: 1,
    blend: 'source-over',
    visible: true,
    parentId: null,
    childIds: [],
  };
}

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

export function createRasterLayer(name: string, w: number, h: number, id = newLayerId()): RasterLayer {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return {
    id,
    type: 'raster',
    name,
    canvas,
    ctx,
    opacity: 1,
    blend: 'source-over',
    visible: true,
    parentId: null,
    childIds: [],
  };
}

export function createAdjustLayer(name: string, id = newLayerId()): AdjustLayer {
  return {
    id,
    type: 'adjust',
    name,
    params: { ...DEFAULT_ADJUST },
    maskLayerIds: [],
    opacity: 1,
    blend: 'source-over',
    visible: true,
    parentId: null,
    childIds: [],
  };
}

export function createOutlineLayer(name: string, id = newLayerId()): OutlineLayer {
  return {
    id,
    type: 'outline',
    name,
    outline: { ...DEFAULT_OUTLINE },
    opacity: 1,
    blend: 'source-over',
    visible: true,
    parentId: null,
    childIds: [],
  };
}

export function createClipLayer(name: string, id = newLayerId()): ClipLayer {
  return {
    id,
    type: 'clip',
    name,
    maskLayerIds: [],
    opacity: 1,
    blend: 'source-over',
    visible: true,
    parentId: null,
    childIds: [],
  };
}

export function createShapeLayer(name: string, shape: ShapeParams, id = newLayerId(), snapEnabled = true): ShapeLayer {
  return {
    id,
    type: 'shape',
    name,
    shape,
    snapEnabled,
    opacity: 1,
    blend: 'source-over',
    visible: true,
    parentId: null,
    childIds: [],
  };
}

export function buildFilter(p: AdjustParams): string {
  return `brightness(${p.brightness}%) contrast(${p.contrast}%) hue-rotate(${p.hue}deg) saturate(${p.saturation}%)`;
}
