import {
  ART_H,
  ART_W,
  DEFAULT_ADJUST,
  type AdjustParams,
  type BlendMode,
} from '../types';

export interface RasterLayer {
  id: string;
  type: 'raster';
  name: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
}

export interface AdjustLayer {
  id: string;
  type: 'adjust';
  name: string;
  params: AdjustParams;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
}

export type Layer = RasterLayer | AdjustLayer;

let idCounter = 0;
export function newLayerId(): string {
  return `L${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

export function makeCanvas(w = ART_W, h = ART_H): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function createRasterLayer(name: string, id = newLayerId()): RasterLayer {
  const canvas = makeCanvas();
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
  };
}

export function createAdjustLayer(name: string, id = newLayerId()): AdjustLayer {
  return {
    id,
    type: 'adjust',
    name,
    params: { ...DEFAULT_ADJUST },
    opacity: 1,
    blend: 'source-over',
    visible: true,
  };
}

export function buildFilter(p: AdjustParams): string {
  return `brightness(${p.brightness}%) contrast(${p.contrast}%) hue-rotate(${p.hue}deg) saturate(${p.saturation}%)`;
}
