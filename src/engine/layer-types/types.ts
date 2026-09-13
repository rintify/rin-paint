import type { Layer } from '../layers';
import type { TextRenderer } from '../text/render';
import type { LayerDefinition } from './definition';

export interface PagePixelSize {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface LayerContentEnv {
  pageFrame: PagePixelSize;
  /** Present for persisted v11 geometry; omitted by lightweight unit hosts. */
  ppi?: number;
}

export interface LayerRestoreEnv extends LayerContentEnv {
  name: string;
}

export interface LayerSnapshotEnv extends LayerContentEnv {
  withContent: boolean;
  keepCanvas: boolean;
  onEncoded(): void;
}

export interface LayerScaleEnv {
  width: number;
  height: number;
}

export interface LayerStoredScaleEnv extends LayerContentEnv {
  factor: number;
}

export interface LayerMeasureEnv {
  pageFrame: PagePixelSize;
  textRenderer: TextRenderer;
  ppi: number;
}

export interface LayerDrawEnv extends LayerMeasureEnv {
  originX: number;
  originY: number;
  layerById(id: string): Layer | null;
  handlerFor(layer: Layer): LayerDefinition<Layer['type']>;
  borrowCanvas(width?: number, height?: number): CanvasLease;
  borrowReadbackCanvas(width?: number, height?: number): CanvasLease;
  ppi: number;
  maskCanvas(ids: string[]): MaskCanvas | null;
  drawEffectContribution(ctx: CanvasRenderingContext2D, layerId: string): void;
  effectCache: EffectCacheStore;
  stats: RenderStatsAccumulator;
  drawAboveLayer?(ctx: CanvasRenderingContext2D, layerId: string): void;
}

export interface RenderStatsAccumulator {
  cpuReadbackPixels: number;
  canvasBorrows: number;
}

export interface CanvasLease {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  release(): void;
}

export interface MaskCanvas {
  canvas: HTMLCanvasElement;
  opacity: number;
  x: number;
  y: number;
  release(): void;
}

export interface EffectScope {
  canvas: HTMLCanvasElement;
  coverage: HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
  inputRevision: number;
  /** Optional larger lower-scope render used by projective transforms. */
  sourceCanvas?: HTMLCanvasElement;
  sourceX?: number;
  sourceY?: number;
}

export interface EffectCacheStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, bytes: number, dispose?: () => void): void;
}

export interface ObjectBounds {
  x: number;
  y: number;
  w: number;
  h: number;
  width?: number;
  height?: number;
}

export type { LayerDefinition, LayerProps, LayerRecord, LayerSnapshot } from './definition';
