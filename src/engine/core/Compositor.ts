import { shapeVisualPadding } from '../shapes';
import { RasterSurface, RasterEditSession } from '../raster/RasterSurface';
import { tileCoordinates, tileKey, tileRect } from '../raster/geometry';
import { traceSparseAlphaContours } from '../layer-types/effectUtils';
import { RegionRenderer, type LayerHitCapture } from './RegionRenderer';
import { layerHandler } from '../layer-types/registry';
import type {
  CanvasLease,
  LayerDrawEnv,
  LayerMeasureEnv,
} from '../layer-types/types';
import { makeCanvas, type Layer } from '../layers';
import { TextRenderer } from '../text/render';
import type { PaintEngine } from '../PaintEngine';
import { CanvasPool } from './CanvasPool';
import { MaskRenderer } from './MaskRenderer';
import { unionRect, type DirtyRect } from '../brush';
import { EffectCache } from './EffectCache';

interface RenderRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clampDirty(
  rect: DirtyRect,
  width: number,
  height: number,
): DirtyRect | null {
  const value = {
    minX: Math.max(0, Math.floor(rect.minX)),
    minY: Math.max(0, Math.floor(rect.minY)),
    maxX: Math.min(width, Math.ceil(rect.maxX)),
    maxY: Math.min(height, Math.ceil(rect.maxY)),
  };
  return value.maxX > value.minX && value.maxY > value.minY ? value : null;
}

function expandDirty(rect: DirtyRect, amount: number): DirtyRect {
  return {
    minX: Math.floor(rect.minX - amount),
    minY: Math.floor(rect.minY - amount),
    maxX: Math.ceil(rect.maxX + amount),
    maxY: Math.ceil(rect.maxY + amount),
  };
}

function asRenderRect(rect: DirtyRect): RenderRect {
  return {
    x: rect.minX,
    y: rect.minY,
    w: rect.maxX - rect.minX,
    h: rect.maxY - rect.minY,
  };
}

function unionBounds(
  a: RenderRect | null,
  b: RenderRect | null,
): RenderRect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w),
    bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}

function intersectBounds(
  a: RenderRect | null,
  b: RenderRect,
): RenderRect | null {
  if (!a) return null;
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w),
    bottom = Math.min(a.y + a.h, b.y + b.h);
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
}

/** Owns canvases, text renderer, and the composite/render loop. */
export class Compositor {
  main: HTMLCanvasElement | null = null;
  mainCtx: CanvasRenderingContext2D | null = null;
  overlayCtx: CanvasRenderingContext2D | null = null;
  private overlaySurface: HTMLCanvasElement | null = null;
  private overlayArea: HTMLElement | null = null;

  fillReference = makeCanvas(1600, 1200);
  fillReferenceCtx = this.fillReference.getContext('2d', {
    willReadFrequently: true,
  })!;
  private readonly artCache = makeCanvas(1600, 1200);
  private artCacheCtx = this.artCache.getContext('2d')!;

  private readonly canvasPool = new CanvasPool();
  private readonly readbackCanvasPool = new CanvasPool(
    true,
    2,
    16 * 1024 * 1024,
  );
  private readonly effectCache = new EffectCache();
  private readonly maskRenderer = new MaskRenderer(this.effectCache);

  textRenderer = new TextRenderer();
  dirty = true;
  private fullDirty = true;
  private readonly damageByLayer = new Map<string, DirtyRect[]>();
  overlayDirty = true;
  raf = 0;
  /** テスト・計測用。直近フレームで実際に合成した画素面積。 */
  lastCompositedPixels = 0;
  private readonly frameStats = { cpuReadbackPixels: 0, canvasBorrows: 0 };

  renderStats(): {
    compositedPixels: number;
    cpuReadbackPixels: number;
    canvasBorrows: number;
    maskCacheHits: number;
    maskCacheMisses: number;
    effectCacheHits: number;
    effectCacheMisses: number;
  } {
    return {
      compositedPixels: this.lastCompositedPixels,
      cpuReadbackPixels: this.frameStats.cpuReadbackPixels,
      canvasBorrows: this.frameStats.canvasBorrows,
      maskCacheHits: this.maskRenderer.hits,
      maskCacheMisses: this.maskRenderer.misses,
      effectCacheHits: this.effectCache.hits,
      effectCacheMisses: this.effectCache.misses,
    };
  }

  private readonly regions: RegionRenderer;
  constructor(private engine: PaintEngine) {
    this.regions = new RegionRenderer({
      engine,
      borrowCanvas: (w, h) => this.borrowCanvas(w, h),
      drawEnv: (tools, w, h, x, y) => this.drawEnv(tools, w, h, x, y),
      sequenceVisibleBounds: (ids) => this.sequenceVisibleBounds(ids),
    });
  }

  requestRender(): void {
    this.dirty = true;
    this.fullDirty = true;
    this.damageByLayer.clear();
    this.overlayDirty = true;
    this.scheduleFrame();
  }

  invalidateLayer(layerId: string, rect: DirtyRect): void {
    const clipped = rect;
    this.dirty = true;
    if (!this.fullDirty) {
      const previous = this.damageByLayer.get(layerId);
      this.damageByLayer.set(
        layerId,
        previous ? [...previous, clipped] : [clipped],
      );
    }
    this.scheduleFrame();
  }

  requestOverlayRender(): void {
    this.overlayDirty = true;
    this.scheduleFrame();
  }

  private scheduleFrame(): void {
    if (this.raf || (!this.main && !this.overlayCtx)) return;
    this.raf = requestAnimationFrame(this.loop);
  }

  ensureComposited(): void {
    if (this.dirty) this.composite();
  }

  syncWorkCanvases(): void {
    const { w, h } = this.engine.artboard;
    for (const c of [this.fillReference, this.artCache]) {
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
        if (c === this.artCache) {
          this.artCacheCtx = this.artCache.getContext('2d')!;
          this.fullDirty = true;
        }
      }
    }
  }

  private borrowCanvas(
    width = this.engine.artboard.w,
    height = this.engine.artboard.h,
  ): CanvasLease {
    this.frameStats.canvasBorrows++;
    return this.canvasPool.acquire(width, height);
  }

  private borrowReadbackCanvas(
    width = this.engine.artboard.w,
    height = this.engine.artboard.h,
  ): CanvasLease {
    this.frameStats.canvasBorrows++;
    return this.readbackCanvasPool.acquire(width, height);
  }

  measureEnv(): LayerMeasureEnv {
    return {
      artboard: this.engine.artboard,
      textRenderer: this.textRenderer,
      ppi: this.engine.getPageSpec().ppi,
    };
  }

  /** レイヤー種別ハンドラが描画に使う依存一式 */
  drawEnv(
    withToolOverlay: boolean,
    width = this.engine.artboard.w,
    height = this.engine.artboard.h,
    originX = 0,
    originY = 0,
  ): LayerDrawEnv {
    const eng = this.engine;
    const tool = withToolOverlay ? eng.activeTool() : null;
    const drawAboveLayer = tool?.drawAboveLayer?.bind(tool);
    const env: LayerDrawEnv = {
      artboard: eng.artboard,
      outputRegion: { x: originX, y: originY, w: width, h: height },
      inputRegion: { x: originX, y: originY, w: width, h: height },
      paperRect: { x: 0, y: 0, w: eng.artboard.w, h: eng.artboard.h },
      sharpContours: (id, threshold, revision) =>
        this.sharpContours(id, threshold, revision, withToolOverlay),
      originX,
      originY,
      textRenderer: this.textRenderer,
      layerById: (id) => eng.layerById(id),
      handlerFor: layerHandler,
      borrowCanvas: (w = width, h = height) => this.borrowCanvas(w, h),
      borrowReadbackCanvas: (w = width, h = height) =>
        this.borrowReadbackCanvas(w, h),
      ppi: eng.getPageSpec().ppi,
      maskCanvas: (ids) =>
        this.maskRenderer.render(
          ids,
          env,
          (id) => eng.getMaskRevision?.(id) ?? 0,
          { x: originX, y: originY, w: width, h: height },
        ),
      drawEffectContribution: (ctx, layerId) => {
        const contribution = this.renderEffectContribution(layerId, {
          x: originX,
          y: originY,
          w: width,
          h: height,
        });
        ctx.drawImage(contribution.canvas, originX, originY);
        contribution.release();
      },
      effectCache: this.effectCache,
      stats: this.frameStats,
      drawAboveLayer,
    };
    return env;
  }

  invalidateMaskLayer(id: string): void {
    this.maskRenderer.invalidateLayer(id);
  }

  clearCaches(): void {
    this.maskRenderer.clear();
    this.effectCache.clear();
    this.canvasPool.clear();
    this.readbackCanvasPool.clear();
  }

  syncTextRenders(): void {
    const layers = this.engine.allLayers();
    const prepared = layers.filter(
      (layer) => layerHandler(layer).capabilities.renderLifecycle?.prepare,
    );
    this.textRenderer.retain(new Set(prepared.map((layer) => layer.id)));
    const env = this.measureEnv();
    for (const layer of prepared) {
      layerHandler(layer).capabilities.renderLifecycle!.prepare!(
        layer as never,
        env,
        () => {
          this.engine.bumpLayer(layer.id);
          this.engine.syncStore();
        },
      );
    }
  }

  async readyToRender(): Promise<void> {
    this.syncTextRenders();
    await this.textRenderer.ready();
    this.ensureComposited();
  }

  compositeCanvas(): HTMLCanvasElement | null {
    return this.main;
  }

  renderLayerHitMask(layerId: string, region?: RenderRect): CanvasLease {
    const { w, h } = this.engine.artboard;
    const bounds = region ?? { x: 0, y: 0, w, h };
    const padding = this.maximumEffectPadding(),
      input = {
        x: bounds.x - padding,
        y: bounds.y - padding,
        w: bounds.w + padding * 2,
        h: bounds.h + padding * 2,
      };
    const hit: LayerHitCapture = { layerId, contribution: null, target: null };
    const art = this.renderArt(input, null, false, undefined, hit);
    art.release();
    const result = this.borrowCanvas(bounds.w, bounds.h);
    if (hit.contribution) {
      result.ctx.drawImage(
        hit.contribution.canvas,
        padding,
        padding,
        bounds.w,
        bounds.h,
        0,
        0,
        bounds.w,
        bounds.h,
      );
      hit.contribution.release();
    }
    return result;
  }

  samplePixel(
    x: number,
    y: number,
    includedLayerId: string | null,
  ): Uint8ClampedArray {
    const cx = Math.max(0, Math.min(this.engine.artboard.w - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(this.engine.artboard.h - 1, Math.round(y)));
    if (includedLayerId === null) {
      this.ensureComposited();
      return this.artCacheCtx.getImageData(cx, cy, 1, 1).data;
    }
    const layer = this.engine.layerById(includedLayerId);
    const padding = layer
      ? Math.max(
          0,
          layerHandler(layer).renderer.effect?.paddingPx?.(
            layer as never,
            this.drawEnv(false),
          ) ?? 0,
        )
      : 0;
    const region = {
      x: cx - padding,
      y: cy - padding,
      w: padding * 2 + 1,
      h: padding * 2 + 1,
    };
    const art =
      layer && layerHandler(layer).renderer.effect
        ? this.renderEffectContribution(includedLayerId, region)
        : this.renderArt(region, new Set([includedLayerId]), false);
    const data = art.ctx.getImageData(cx - region.x, cy - region.y, 1, 1).data;
    art.release();
    return data;
  }

  startLoop(): void {
    this.dirty = true;
    this.fullDirty = true;
    this.overlayDirty = true;
    this.scheduleFrame();
  }

  stopLoop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  attachCanvases(
    main: HTMLCanvasElement,
    overlay: HTMLCanvasElement,
    overlayArea?: HTMLElement,
  ): void {
    this.main = main;
    this.mainCtx = main.getContext('2d')!;
    this.overlaySurface = overlay;
    this.overlayArea = overlayArea ?? null;
    this.overlayCtx = overlay.getContext('2d')!;
  }

  detachCanvases(): void {
    this.stopLoop();
    this.main = null;
    this.mainCtx = null;
    this.overlaySurface = null;
    this.overlayArea = null;
    this.overlayCtx = null;
  }

  private loop = (): void => {
    this.raf = 0;
    if (this.dirty) this.composite();
    if (
      this.overlayDirty ||
      this.engine.overlayAnimated?.() ||
      this.engine.activeTool().overlayAnimated?.()
    ) {
      this.drawOverlayFrame();
      this.overlayDirty = false;
    }
    if (
      this.engine.overlayAnimated?.() ||
      this.engine.activeTool().overlayAnimated?.()
    )
      this.scheduleFrame();
  };

  composite(): void {
    const ctx = this.mainCtx;
    const surface = this.main;
    if (!ctx || !surface) return;
    this.frameStats.cpuReadbackPixels = 0;
    this.frameStats.canvasBorrows = 0;
    this.syncWorkCanvases();
    if (this.fullDirty || !this.damageByLayer.size)
      this.compositeFull(ctx, true);
    else this.compositePartial(ctx, this.damageByLayer);
    this.dirty = false;
    this.fullDirty = false;
    this.damageByLayer.clear();
  }

  compositeSelection(ids: Set<string>): HTMLCanvasElement {
    this.syncWorkCanvases();
    const { w, h } = this.engine.artboard;
    const pad = this.maximumEffectPadding();
    const art = this.renderArt(
      { x: -pad, y: -pad, w: w + pad * 2, h: h + pad * 2 },
      ids,
      false,
    );
    this.fillReferenceCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.fillReferenceCtx.clearRect(0, 0, w, h);
    this.fillReferenceCtx.fillStyle = '#ffffff';
    this.fillReferenceCtx.fillRect(0, 0, w, h);
    this.fillReferenceCtx.drawImage(art.canvas, pad, pad, w, h, 0, 0, w, h);
    art.release();
    return this.fillReference;
  }

  contentBounds(layer: Layer): RenderRect | null {
    if (
      layer.type === 'shape' &&
      'paintMode' in layer.state.shape &&
      layer.state.shape.paintMode === 'fill-outside'
    )
      return {
        x: 0,
        y: 0,
        w: this.engine.artboard.w,
        h: this.engine.artboard.h,
      };
    if (layer.type === 'raster') {
      return layer.runtime.surface.getContentBounds();
    }
    const capability = layerHandler(layer).capabilities.objectTransform;
    const bounds = capability?.bounds(layer as never, this.measureEnv());
    const pad =
      layer.type === 'shape' ? shapeVisualPadding(layer.state.shape) : 0;
    return bounds
      ? {
          x: bounds.x - pad,
          y: bounds.y - pad,
          w: bounds.w + pad * 2,
          h: bounds.h + pad * 2,
        }
      : null;
  }

  private sequenceVisibleBounds(
    ids: string[],
    initial: RenderRect | null = null,
  ): RenderRect | null {
    let current = initial;
    const env = this.drawEnv(false);
    for (const id of ids) {
      const layer = this.engine.layerById(id);
      if (!layer) continue;
      const effect = layerHandler(layer).renderer.effect;
      if (effect) {
        if (layer.visible && current) {
          const padding = Math.max(
            0,
            effect.paddingPx?.(layer as never, env) ?? 0,
          );
          if (padding)
            current = {
              x: current.x - padding,
              y: current.y - padding,
              w: current.w + padding * 2,
              h: current.h + padding * 2,
            };
          if (
            layer.type === 'clip' &&
            layer.opacity >= 1 &&
            layer.state.maskLayerIds.length
          ) {
            let masks: RenderRect | null = null;
            for (const maskId of layer.state.maskLayerIds) {
              const maskLayer = this.engine.layerById(maskId);
              if (maskLayer)
                masks = unionBounds(masks, this.contentBounds(maskLayer));
            }
            if (masks) current = intersectBounds(current, masks);
          }
        }
        current = this.sequenceVisibleBounds(layer.childIds, current);
      } else {
        let subtree = this.contentBounds(layer);
        subtree = this.sequenceVisibleBounds(layer.childIds, subtree);
        current = unionBounds(current, subtree);
      }
    }
    return current;
  }

  private sharpContours(
    id: string,
    threshold: number,
    revision: number,
    tools: boolean,
  ): Array<Array<{ x: number; y: number }>> {
    const key = `sharp-contours:${id}:${revision}:${threshold}:${tools}:${this.engine.getPageSpec().ppi}`;
    const cached =
      this.effectCache.get<Array<Array<{ x: number; y: number }>>>(key);
    if (cached) return cached;
    const candidates = new Map<string, { tx: number; ty: number }>(),
      layers = this.engine.allLayers();
    const pad = layers.reduce(
      (n, l) =>
        n +
        (layerHandler(l).renderer.effect?.paddingPx?.(
          l as never,
          this.drawEnv(false),
        ) ?? 0),
      0,
    );
    const add = (r: RenderRect) => {
      for (const t of tileCoordinates({
        x: r.x - pad,
        y: r.y - pad,
        w: r.w + pad * 2,
        h: r.h + pad * 2,
      }))
        candidates.set(tileKey(t.tx, t.ty), t);
    };
    for (const layer of layers) {
      if (layer.type === 'raster') {
        for (const tile of layer.runtime.surface.entries())
          add({
            ...tile.asset.bounds,
            x: tile.tx * 256 + tile.asset.bounds.x,
            y: tile.ty * 256 + tile.asset.bounds.y,
          });
      } else if (!layerHandler(layer).renderer.effect) {
        const bounds = this.contentBounds(layer);
        if (bounds) add(bounds);
      }
    }
    const surface = new RasterSurface(),
      edit = new RasterEditSession(surface);
    for (const { tx, ty } of candidates.values()) {
      const out = tileRect(tx, ty),
        input = {
          x: out.x - pad,
          y: out.y - pad,
          w: out.w + pad * 2,
          h: out.h + pad * 2,
        };
      const capture = { effectId: id, result: null as CanvasLease | null };
      const art = this.regions.render(
        input,
        null,
        tools,
        undefined,
        undefined,
        capture,
      );
      art.release();
      if (capture.result) {
        try {
          edit.mutateRegion(out, (ctx) =>
            ctx.drawImage(
              capture.result!.canvas,
              pad,
              pad,
              out.w,
              out.h,
              out.x,
              out.y,
              out.w,
              out.h,
            ),
          );
        } finally {
          capture.result.release();
        }
      }
    }
    edit.commit(false);
    this.frameStats.cpuReadbackPixels += surface.tileCount * 256 * 256;
    const contours = traceSparseAlphaContours(
      surface,
      Math.max(0, Math.min(1, threshold)) * 255,
    );
    this.effectCache.set(
      key,
      contours,
      Math.max(
        1,
        contours.reduce((n, c) => n + c.length * 16, 0),
      ),
    );
    return contours;
  }

  private renderArt(
    ...args: Parameters<RegionRenderer['render']>
  ): CanvasLease {
    return this.regions.render(...args);
  }

  private maximumEffectPadding(): number {
    return Math.max(
      0,
      ...this.effectPaddingByLayer(this.drawEnv(false)).values(),
    );
  }
  private renderEffectContribution(
    layerId: string,
    region: RenderRect,
  ): CanvasLease {
    const pad = this.maximumEffectPadding(),
      input = {
        x: region.x - pad,
        y: region.y - pad,
        w: region.w + pad * 2,
        h: region.h + pad * 2,
      };
    const capture = {
      effectId: layerId,
      contribution: null as CanvasLease | null,
    };
    const art = this.renderArt(input, null, false, capture);
    art.release();
    const result = this.borrowCanvas(region.w, region.h);
    if (capture.contribution) {
      result.ctx.drawImage(
        capture.contribution.canvas,
        pad,
        pad,
        region.w,
        region.h,
        0,
        0,
        region.w,
        region.h,
      );
      capture.contribution.release();
    }
    return result;
  }

  private compositeFull(
    ctx: CanvasRenderingContext2D,
    _withTools: boolean,
  ): void {
    const { w, h } = this.engine.artboard;
    const damage = new Map(
      this.engine
        .allLayers()
        .map((layer) => [layer.id, [{ minX: 0, minY: 0, maxX: w, maxY: h }]]),
    );
    this.compositePartial(ctx, damage);
  }

  private effectPaddingByLayer(env: LayerDrawEnv): Map<string, number> {
    const eng = this.engine;
    const activeEffectInChain = (layer: Layer): boolean => {
      const effect = layerHandler(layer).renderer.effect;
      if (effect && layer.visible) return true;
      return layer.childIds.some((id) => {
        const child = eng.layerById(id);
        return !!child && activeEffectInChain(child);
      });
    };
    const merge = (
      target: Map<string, number>,
      source: Map<string, number>,
    ) => {
      for (const [id, padding] of source)
        target.set(id, Math.max(target.get(id) ?? 0, padding));
    };
    const visit = (ids: string[], state: Map<string, number>) => {
      for (const id of ids) {
        const layer = eng.layerById(id);
        if (!layer) continue;
        const effect = layerHandler(layer).renderer.effect;
        if (effect) {
          if (layer.visible) {
            const padding = Math.max(0, effect.paddingPx?.(layer, env) ?? 0);
            if (padding)
              for (const [sourceId, value] of state)
                state.set(sourceId, value + padding);
            for (const dependencyId of effect.dependencyLayerIds?.(layer) ??
              []) {
              state.set(
                dependencyId,
                Math.max(state.get(dependencyId) ?? 0, padding),
              );
            }
          }
          visit(layer.childIds, state);
          continue;
        }
        if (
          layer.childIds.some((childId) => {
            const child = eng.layerById(childId);
            return !!child && activeEffectInChain(child);
          })
        ) {
          const local = new Map<string, number>();
          if (layer.visible) local.set(layer.id, 0);
          visit(layer.childIds, local);
          merge(state, local);
        } else {
          if (layer.visible)
            state.set(layer.id, Math.max(state.get(layer.id) ?? 0, 0));
          visit(layer.childIds, state);
        }
      }
    };
    const result = new Map<string, number>();
    visit(eng.getRootLayerIds(), result);
    return result;
  }

  private compositePartial(
    ctx: CanvasRenderingContext2D,
    damages: Map<string, DirtyRect[]>,
  ): void {
    const { w, h } = this.engine.artboard;
    const env = this.drawEnv(true);
    const paddingByLayer = this.effectPaddingByLayer(env);
    const outputs: DirtyRect[] = [];
    let evaluationPadding = 0;
    for (const [layerId, changes] of damages) {
      const padding = paddingByLayer.get(layerId) ?? 0;
      evaluationPadding = Math.max(evaluationPadding, padding);
      for (const damage of changes) {
        let next = clampDirty(expandDirty(damage, padding), w, h);
        if (!next) continue;
        // Only merge intersecting damage; distant edits never fill their gap.
        for (let i = outputs.length - 1; i >= 0; i--) {
          const r = outputs[i];
          if (
            next.minX <= r.maxX &&
            next.maxX >= r.minX &&
            next.minY <= r.maxY &&
            next.maxY >= r.minY
          ) {
            next = unionRect(next, r);
            outputs.splice(i, 1);
          }
        }
        outputs.push(next);
      }
    }
    const pad =
      evaluationPadding > 0
        ? Math.max(4, 2 ** Math.ceil(Math.log2(evaluationPadding)))
        : 0;
    this.lastCompositedPixels = 0;
    const nativeOnly = !this.engine
      .allLayers()
      .some((layer) => layer.visible && layerHandler(layer).renderer.effect);
    const renderOutput = (output: DirtyRect) => {
      const outputRegion = asRenderRect(output),
        evaluationRegion = asRenderRect(expandDirty(output, pad));
      if (nativeOnly) {
        this.regions.renderNativeInto(this.artCacheCtx, outputRegion);
        this.present(ctx, this.artCache, outputRegion, false);
        this.lastCompositedPixels += outputRegion.w * outputRegion.h;
        return;
      }
      const art = this.renderArt(evaluationRegion, null, true);
      try {
        this.artCacheCtx.clearRect(
          outputRegion.x,
          outputRegion.y,
          outputRegion.w,
          outputRegion.h,
        );
        this.artCacheCtx.drawImage(
          art.canvas,
          pad,
          pad,
          outputRegion.w,
          outputRegion.h,
          outputRegion.x,
          outputRegion.y,
          outputRegion.w,
          outputRegion.h,
        );
        this.present(ctx, this.artCache, outputRegion, false);
        this.lastCompositedPixels += evaluationRegion.w * evaluationRegion.h;
      } finally {
        art.release();
      }
    };
    // Native image/vector composition needs no pixel filtering halo. Replaying a large photo
    // once per 256px tile multiplies browser resampling work without reducing readback.
    for (const output of outputs) {
      if (
        nativeOnly ||
        (output.maxX - output.minX <= 512 && output.maxY - output.minY <= 512)
      )
        renderOutput(output);
      else
        for (const tile of tileCoordinates(asRenderRect(output))) {
          const r = intersectBounds(
            tileRect(tile.tx, tile.ty),
            asRenderRect(output),
          );
          if (r)
            renderOutput({
              minX: r.x,
              minY: r.y,
              maxX: r.x + r.w,
              maxY: r.y + r.h,
            });
        }
    }
  }

  private present(
    ctx: CanvasRenderingContext2D,
    art: HTMLCanvasElement,
    region: RenderRect,
    clearAll: boolean,
  ): void {
    const { w, h } = this.engine.artboard;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    if (clearAll) ctx.clearRect(0, 0, w, h);
    else ctx.clearRect(region.x, region.y, region.w, region.h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(region.x, region.y, region.w, region.h);
    ctx.drawImage(
      art,
      region.x,
      region.y,
      region.w,
      region.h,
      region.x,
      region.y,
      region.w,
      region.h,
    );
    ctx.restore();
  }

  drawOverlayFrame(): void {
    const surface = this.overlaySurface;
    if (!surface) return;
    const eng = this.engine;
    const area = this.overlayArea;
    if (!area || !eng.view) {
      const ctx = this.overlayCtx!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, eng.artboard.w, eng.artboard.h);
      this.paintToolOverlays(eng, ctx);
      eng.drawActiveShapeHandles(ctx);
      eng.drawLoupeIfAny(ctx);
      return;
    }
    const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
    const cssWidth = Math.max(1, area?.clientWidth ?? eng.artboard.w);
    const cssHeight = Math.max(1, area?.clientHeight ?? eng.artboard.h);
    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (surface.width !== pixelWidth || surface.height !== pixelHeight) {
      surface.width = pixelWidth;
      surface.height = pixelHeight;
      this.overlayCtx = surface.getContext('2d')!;
    }
    const ctx = this.overlayCtx!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);

    const displayScale = eng.view.displayScale();
    const cos = Math.cos(eng.view.rot);
    const sin = Math.sin(eng.view.rot);
    const a = cos * displayScale * dpr;
    const b = sin * displayScale * dpr;
    const c = -sin * displayScale * dpr;
    const d = cos * displayScale * dpr;
    const centerX = (cssWidth / 2 + eng.view.x) * dpr;
    const centerY = (cssHeight / 2 + eng.view.y) * dpr;
    ctx.setTransform(
      a,
      b,
      c,
      d,
      centerX - (a * eng.artboard.w) / 2 - (c * eng.artboard.h) / 2,
      centerY - (b * eng.artboard.w) / 2 - (d * eng.artboard.h) / 2,
    );
    ctx.save();
    ctx.beginPath();

    this.paintToolOverlays(eng, ctx);
    eng.drawActiveShapeHandles(ctx);
    eng.drawLoupeIfAny(ctx);
    ctx.restore();
  }

  private paintToolOverlays(
    eng: PaintEngine,
    ctx: CanvasRenderingContext2D,
  ): void {
    if (eng.drawToolOverlays) eng.drawToolOverlays(ctx);
    else eng.activeTool().drawOverlay?.(ctx);
  }
}
