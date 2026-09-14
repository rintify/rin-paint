import { layerHandler } from '../layer-types/registry';
import type { CanvasLease, LayerDrawEnv, LayerMeasureEnv } from '../layer-types/types';
import { makeCanvas, type Layer, type RasterLayer } from '../layers';
import { TextRenderer } from '../text/render';
import type { PaintEngine } from '../PaintEngine';
import { CanvasPool } from './CanvasPool';
import { MaskRenderer } from './MaskRenderer';
import { unionRect, type DirtyRect } from '../brush';
import { EffectCache } from './EffectCache';
import { SceneQuery } from './SceneQuery';
import { inverse, multiply, scaling, transformBounds } from '../geometry/homography';
import { warpCanvas } from '../geometry/warpCanvas';

interface RenderRect { x: number; y: number; w: number; h: number }

interface LayerHitCapture {
  layerId: string;
  contribution: CanvasLease | null;
  target: HTMLCanvasElement | null;
}

function clampDirty(rect: DirtyRect, width: number, height: number): DirtyRect | null {
  const value = {
    minX: Math.max(0, Math.floor(rect.minX)),
    minY: Math.max(0, Math.floor(rect.minY)),
    maxX: Math.min(width, Math.ceil(rect.maxX)),
    maxY: Math.min(height, Math.ceil(rect.maxY)),
  };
  return value.maxX > value.minX && value.maxY > value.minY ? value : null;
}

function expandDirty(rect: DirtyRect, amount: number, width: number, height: number): DirtyRect {
  return {
    minX: Math.max(0, Math.floor(rect.minX - amount)),
    minY: Math.max(0, Math.floor(rect.minY - amount)),
    maxX: Math.min(width, Math.ceil(rect.maxX + amount)),
    maxY: Math.min(height, Math.ceil(rect.maxY + amount)),
  };
}

function asRenderRect(rect: DirtyRect): RenderRect {
  return { x: rect.minX, y: rect.minY, w: rect.maxX - rect.minX, h: rect.maxY - rect.minY };
}

function unionBounds(a: RenderRect | null, b: RenderRect | null): RenderRect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w), bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}

function intersectBounds(a: RenderRect | null, b: RenderRect): RenderRect | null {
  if (!a) return null;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w), bottom = Math.min(a.y + a.h, b.y + b.h);
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
}

function mixRevision(current: number, token: string | number): number {
  const value = String(token);
  let hash = current >>> 0;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** Owns canvases, text renderer, and the composite/render loop. */
export class Compositor {
  main: HTMLCanvasElement | null = null;
  mainCtx: CanvasRenderingContext2D | null = null;
  overlayCtx: CanvasRenderingContext2D | null = null;
  private overlaySurface: HTMLCanvasElement | null = null;
  private overlayArea: HTMLElement | null = null;

  /** ストローク開始時のレイヤー内容 (履歴パッチの before 側) */
  scratch = makeCanvas(1600, 1200);
  scratchCtx = this.scratch.getContext('2d', { willReadFrequently: true })!;
  fillReference = makeCanvas(1600, 1200);
  fillReferenceCtx = this.fillReference.getContext('2d', { willReadFrequently: true })!;
  private readonly artCache = makeCanvas(1600, 1200);
  private artCacheCtx = this.artCache.getContext('2d')!;

  private readonly canvasPool = new CanvasPool();
  private readonly readbackCanvasPool = new CanvasPool(true, 2, 16 * 1024 * 1024);
  private readonly effectCache = new EffectCache();
  private readonly maskRenderer = new MaskRenderer(this.effectCache);

  textRenderer = new TextRenderer();
  dirty = true;
  private fullDirty = true;
  private readonly damageByLayer = new Map<string, DirtyRect>();
  overlayDirty = true;
  raf = 0;
  /** テスト・計測用。直近フレームで実際に合成した画素面積。 */
  lastCompositedPixels = 0;
  private readonly frameStats = { cpuReadbackPixels: 0, canvasBorrows: 0 };

  renderStats(): { compositedPixels: number; cpuReadbackPixels: number; canvasBorrows: number; maskCacheHits: number; maskCacheMisses: number; effectCacheHits: number; effectCacheMisses: number } {
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

  constructor(private engine: PaintEngine) {}

  requestRender(): void {
    this.dirty = true;
    this.fullDirty = true;
    this.damageByLayer.clear();
    this.overlayDirty = true;
    this.scheduleFrame();
  }

  invalidateLayer(layerId: string, rect: DirtyRect): void {
    // A transformed source can damage pixels far from its local stroke rectangle.
    if (this.engine.allLayers().some(layer => layer.visible && layer.type === 'transform')) {
      this.requestRender(); return;
    }
    const clipped = clampDirty(rect, this.engine.artboard.w, this.engine.artboard.h);
    if (!clipped) return;
    this.dirty = true;
    if (!this.fullDirty) {
      const previous = this.damageByLayer.get(layerId);
      this.damageByLayer.set(layerId, previous ? unionRect(previous, clipped) : clipped);
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
    for (const c of [this.scratch, this.fillReference, this.artCache]) {
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

  private borrowCanvas(width = this.engine.artboard.w, height = this.engine.artboard.h): CanvasLease {
    this.frameStats.canvasBorrows++;
    return this.canvasPool.acquire(width, height);
  }

  private borrowReadbackCanvas(width = this.engine.artboard.w, height = this.engine.artboard.h): CanvasLease {
    this.frameStats.canvasBorrows++;
    return this.readbackCanvasPool.acquire(width, height);
  }

  measureEnv(): LayerMeasureEnv {
    return { artboard: this.engine.artboard, textRenderer: this.textRenderer, ppi: this.engine.getPageSpec().ppi };
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
    const maskRevision = (id: string): number => {
      const layer = eng.layerById(id);
      let revision = eng.getMaskRevision?.(id) ?? 0;
      if (layer?.type === 'canvas') {
        for (const childId of layer.childIds) {
          const child = eng.layerById(childId);
          revision = mixRevision(revision, `${childId}:${child?.visible}:${eng.getRenderRevision?.(childId) ?? 0}:${maskRevision(childId)}`);
        }
      }
      return revision;
    };
    const env: LayerDrawEnv = {
      artboard: eng.artboard,
      originX,
      originY,
      textRenderer: this.textRenderer,
      layerById: (id) => eng.layerById(id),
      handlerFor: layerHandler,
      borrowCanvas: (w = width, h = height) => this.borrowCanvas(w, h),
      borrowReadbackCanvas: (w = width, h = height) => this.borrowReadbackCanvas(w, h),
      ppi: eng.getPageSpec().ppi,
      maskCanvas: (ids) => this.maskRenderer.render(
        ids,
        env,
        maskRevision,
        { x: originX, y: originY, w: width, h: height },
      ),
      drawCanvasScope: (ctx, layerId) => {
        const layer = eng.layerById(layerId);
        if (layer?.type !== 'canvas') return;
        const result = this.renderArt({ x: originX, y: originY, w: width, h: height }, null, false, undefined, undefined, layer.childIds);
        ctx.drawImage(result.canvas, originX, originY);
        result.release();
      },
      drawEffectContribution: (ctx, layerId) => {
        const contribution = this.renderEffectContribution(layerId, { x: originX, y: originY, w: width, h: height });
        ctx.drawImage(contribution.canvas, originX, originY);
        contribution.release();
      },
      effectCache: this.effectCache,
      stats: this.frameStats,
      drawAboveLayer,
    };
    return env;
  }

  invalidateMaskLayer(id: string): void { this.maskRenderer.invalidateLayer(id); }

  clearCaches(): void {
    this.maskRenderer.clear();
    this.effectCache.clear();
    this.canvasPool.clear();
    this.readbackCanvasPool.clear();
  }

  syncTextRenders(): void {
    const layers = this.engine.allLayers();
    const prepared = layers.filter(layer => layerHandler(layer).capabilities.renderLifecycle?.prepare);
    this.textRenderer.retain(new Set(prepared.map(layer => layer.id)));
    const env = this.measureEnv();
    for (const layer of prepared) {
      layerHandler(layer).capabilities.renderLifecycle!.prepare!(layer as never, env, () => {
        this.engine.bumpLayer(layer.id);
        this.engine.syncStore();
      });
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
    const hit: LayerHitCapture = { layerId, contribution: null, target: null };
    const source = this.engine.layerById(layerId);
    const roots = new SceneQuery(this.engine.getRootLayerIds(), this.engine.allLayers()).members(source?.parentId ?? null).map(layer => layer.id);
    const art = this.renderArt(bounds, null, false, undefined, hit, roots);
    art.release();
    return hit.contribution ?? this.borrowCanvas(bounds.w, bounds.h);
  }

  samplePixel(x: number, y: number, includedLayerId: string | null): Uint8ClampedArray {
    const cx = Math.max(0, Math.min(this.engine.artboard.w - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(this.engine.artboard.h - 1, Math.round(y)));
    if (includedLayerId === null && this.engine.layerById(this.engine.getActiveLayerId())?.parentId) {
      const scopeId = this.engine.layerById(this.engine.getActiveLayerId())!.parentId;
      const art = this.renderArt({ x: cx, y: cy, w: 1, h: 1 }, null, false, undefined, undefined, new SceneQuery(this.engine.getRootLayerIds(), this.engine.allLayers()).members(scopeId).map(layer => layer.id));
      const data = art.ctx.getImageData(0,0,1,1).data;
      art.release(); return data;
    }
    if (includedLayerId === null) {
      this.ensureComposited();
      return this.artCacheCtx.getImageData(cx, cy, 1, 1).data;
    }
    const layer = this.engine.layerById(includedLayerId);
    const padding = layer
      ? Math.max(0, layerHandler(layer).renderer.effect?.paddingPx?.(layer as never, this.drawEnv(false)) ?? 0)
      : 0;
    const region = {
      x: Math.max(0, cx - padding),
      y: Math.max(0, cy - padding),
      w: Math.min(this.engine.artboard.w, cx + padding + 1) - Math.max(0, cx - padding),
      h: Math.min(this.engine.artboard.h, cy + padding + 1) - Math.max(0, cy - padding),
    };
    const art = layer && layerHandler(layer).renderer.effect
      ? this.renderEffectContribution(includedLayerId, region)
      : this.renderArt(region, new Set([includedLayerId]), false, undefined, undefined, new SceneQuery(this.engine.getRootLayerIds(), this.engine.allLayers()).members(layer?.parentId ?? null).map(item => item.id));
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

  attachCanvases(main: HTMLCanvasElement, overlay: HTMLCanvasElement, overlayArea?: HTMLElement): void {
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
    if (this.overlayDirty || this.engine.overlayAnimated?.() || this.engine.activeTool().overlayAnimated?.()) {
      this.drawOverlayFrame();
      this.overlayDirty = false;
    }
    if (this.engine.overlayAnimated?.() || this.engine.activeTool().overlayAnimated?.()) this.scheduleFrame();
  };

  composite(): void {
    const ctx = this.mainCtx;
    const surface = this.main;
    if (!ctx || !surface) return;
    this.frameStats.cpuReadbackPixels = 0;
    this.frameStats.canvasBorrows = 0;
    this.syncWorkCanvases();
    if (this.fullDirty || !this.damageByLayer.size) this.compositeFull(ctx, true);
    else this.compositePartial(ctx, this.damageByLayer);
    this.dirty = false;
    this.fullDirty = false;
    this.damageByLayer.clear();
  }

  compositeSelection(ids: Set<string>): HTMLCanvasElement {
    this.syncWorkCanvases();
    const { w, h } = this.engine.artboard;
    const query = new SceneQuery(this.engine.getRootLayerIds(), this.engine.allLayers());
    const scope = query.scopeOf(this.engine.getActiveLayerId());
    const roots = query.members(scope).map(layer => layer.id);
    const allowed = new Set(roots.filter(id => ids.has(id)));
    const art = this.renderArt({ x: 0, y: 0, w, h }, allowed, false, undefined, undefined, roots);
    this.present(this.fillReferenceCtx, art.canvas, { x: 0, y: 0, w, h }, true);
    art.release();
    return this.fillReference;
  }

  private ownVisibleBounds(layer: Layer): RenderRect | null {
    if (!layer.visible) return null;
    if (layer.type === 'raster') {
      const known = layer.runtime.contentBounds;
      if (known === null) return null;
      return known ?? { x: 0, y: 0, w: this.engine.artboard.w, h: this.engine.artboard.h };
    }
    const capability = layerHandler(layer).capabilities.objectTransform;
    const bounds = capability?.bounds(layer as never, this.measureEnv());
    return bounds ? { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h } : null;
  }

  private sequenceVisibleBounds(ids: string[], initial: RenderRect | null = null): RenderRect | null {
    let current = initial;
    const env = this.drawEnv(false);
    for (const id of ids) {
      const layer = this.engine.layerById(id);
      if (!layer) continue;
      const effect = layerHandler(layer).renderer.effect;
      if (effect) {
        if (layer.type === 'transform' && layer.visible && current) {
          const px = this.engine.getPageSpec().ppi / 25.4;
          const matrix = multiply(scaling(px), multiply(layer.state.matrix, scaling(1/px)));
          current = transformBounds(matrix, current);
        }
        if (layer.visible && current) {
          const padding = Math.max(0, effect.paddingPx?.(layer as never, env) ?? 0);
          if (padding) current = { x: current.x - padding, y: current.y - padding, w: current.w + padding * 2, h: current.h + padding * 2 };
        }
      } else {
        let subtree = this.ownVisibleBounds(layer);
        if (layer.type === 'canvas' && layer.visible) subtree = this.sequenceVisibleBounds(layer.childIds);
        current = unionBounds(current, subtree);
      }
    }
    return current;
  }

  private renderArt(
    region: RenderRect,
    included: Set<string> | null,
    drawToolOverlay: boolean,
    capture?: { effectId: string; contribution: CanvasLease | null },
    hit?: LayerHitCapture,
    roots = this.engine.getRootLayerIds(),
  ): CanvasLease {
    const eng = this.engine;
    // The contenteditable text is the synchronous on-canvas preview while typing.
    // Omitting its asynchronously rasterized copy keeps the visible glyphs and
    // the browser caret on the same DOM layout.
    const editingTextId = drawToolOverlay ? eng.getTextEditingId?.() ?? null : null;
    const art = this.borrowCanvas(region.w, region.h);
    const artCtx = art.ctx;
    artCtx.save();
    artCtx.setTransform(1, 0, 0, 1, 0, 0);
    artCtx.globalAlpha = 1;
    artCtx.globalCompositeOperation = 'source-over';
    artCtx.filter = 'none';
    artCtx.restore();
    const env = this.drawEnv(drawToolOverlay, region.w, region.h, region.x, region.y);
    const participates = (layer: Layer) => layer.visible
      && !(layer.type === 'text' && layer.id === editingTextId)
      && (included === null || included.has(layer.id));
    const query = new SceneQuery(eng.getRootLayerIds(), eng.allLayers());
    if (included) {
      included = new Set(included);
      for (const id of [...included]) {
        const expand = (canvasId: string): void => {
          for (const child of query.members(canvasId)) {
            included!.add(child.id);
            if (child.type === 'canvas') expand(child.id);
          }
        };
        if (eng.layerById(id)?.type === 'canvas') expand(id);
      }
    }
    const resetTarget = (target: CanvasRenderingContext2D) => {
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.globalAlpha = 1;
      target.globalCompositeOperation = 'source-over';
      target.filter = 'none';
    };
    const effectScope = (canvas: HTMLCanvasElement, inputRevision: number, activeRegion: RenderRect) => ({
      canvas,
      coverage: canvas,
      x: activeRegion.x,
      y: activeRegion.y,
      width: activeRegion.w,
      height: activeRegion.h,
      inputRevision,
    });
    const drawLayer = (target: CanvasRenderingContext2D, layer: Layer, activeRegion: RenderRect, activeEnv: LayerDrawEnv) => {
      target.save();
      target.setTransform(1, 0, 0, 1, -activeRegion.x, -activeRegion.y);
      layerHandler(layer).renderer.draw(target, layer, activeEnv);
      target.restore();
    };
    const retainHitCoverage = (targetCanvas: HTMLCanvasElement) => {
      if (!hit?.contribution || hit.target !== targetCanvas) return;
      hit.contribution.ctx.save();
      hit.contribution.ctx.setTransform(1, 0, 0, 1, 0, 0);
      hit.contribution.ctx.globalAlpha = 1;
      hit.contribution.ctx.globalCompositeOperation = 'destination-in';
      hit.contribution.ctx.drawImage(targetCanvas, 0, 0);
      hit.contribution.ctx.restore();
    };
    const captureContent = (targetCanvas: HTMLCanvasElement, layer: Layer) => {
      if (!hit || hit.layerId !== layer.id || hit.contribution) return;
      const own = this.borrowCanvas(region.w, region.h);
      drawLayer(own.ctx, layer, region, env);
      hit.contribution = own;
      hit.target = targetCanvas;
    };
    const captureDifference = (targetCanvas: HTMLCanvasElement, before: CanvasLease) => {
      const contribution = this.borrowCanvas(region.w, region.h);
      contribution.ctx.drawImage(targetCanvas, 0, 0);
      contribution.ctx.globalCompositeOperation = 'destination-out';
      contribution.ctx.drawImage(before.canvas, 0, 0);
      contribution.ctx.globalCompositeOperation = 'source-over';
      before.release();
      return contribution;
    };
    const renderSequence = (
      ids: string[],
      target: CanvasRenderingContext2D,
      targetCanvas: HTMLCanvasElement,
      state: { revision: number },
      activeRegion: RenderRect,
      activeEnv: LayerDrawEnv,
    ): boolean => {
      for (let layerIndex = 0; layerIndex < ids.length; layerIndex++) {
        const id = ids[layerIndex];
        const layer = eng.layerById(id);
        if (!layer) continue;
        const handler = layerHandler(layer);
        if (layer.type === 'transform') {
          if (!participates(layer)) continue;
          const px = eng.getPageSpec().ppi / 25.4;
          const matrix = multiply(scaling(px), multiply(layer.state.matrix, scaling(1/px)));
          const inv = inverse(matrix);
          if (!inv) continue;
          const prefix = ids.slice(0,layerIndex);
          const sourceBounds = this.sequenceVisibleBounds(prefix);
          const requested = transformBounds(inv, activeRegion);
          const needed = sourceBounds && requested ? intersectBounds(sourceBounds, requested) : sourceBounds;
          resetTarget(target); target.clearRect(0,0,targetCanvas.width,targetCanvas.height);
          if (needed) {
            const inputRegion = { x: Math.floor(needed.x), y: Math.floor(needed.y),
              w: Math.max(1,Math.ceil(needed.x+needed.w)-Math.floor(needed.x)),
              h: Math.max(1,Math.ceil(needed.y+needed.h)-Math.floor(needed.y)) };
            const input = this.renderArt(inputRegion, included, drawToolOverlay, undefined, undefined, prefix);
            warpCanvas(input.canvas,target,matrix,inputRegion,activeRegion,activeRegion.w,activeRegion.h);
            input.release();
          }
          state.revision = mixRevision(state.revision, `${layer.id}:${eng.getRenderRevision?.(layer.id) ?? 0}`);
          continue;
        }
        if (handler.renderer.effect) {
          const capturingEyedropper = capture?.effectId === layer.id;
          const capturingHitEffect = !!hit && hit.layerId === layer.id && !!handler.renderer.effect.clickableAddedPixels;
          if (participates(layer) || capturingEyedropper || capturingHitEffect) {
            const capturingDifference = capturingEyedropper || capturingHitEffect;
            const before = capturingDifference ? this.borrowCanvas(region.w, region.h) : null;
            before?.ctx.drawImage(targetCanvas, 0, 0);
            const effectEnv = { ...activeEnv, maskCanvas: (ids: string[]) => activeEnv.maskCanvas(query.masks(layer.id, ids).valid) };
            handler.renderer.effect.apply(effectScope(targetCanvas, state.revision, activeRegion), layer, effectEnv);
            resetTarget(target);
            state.revision = mixRevision(state.revision, `${layer.id}:${eng.getRenderRevision?.(layer.id) ?? 0}`);
            if (capturingDifference && before) {
              const contribution = captureDifference(targetCanvas, before);
              if (capturingEyedropper && capture) {
                capture.contribution = contribution;
                return true;
              }
              hit!.contribution = contribution;
              hit!.target = targetCanvas;
            } else {
              retainHitCoverage(targetCanvas);
            }
          }
          continue;
        }

        if (layer.type === 'canvas') {
          if (!layer.visible) continue;
          const scope = this.borrowCanvas(activeRegion.w, activeRegion.h);
          const localState = { revision: mixRevision(2166136261, layer.id) };
          const stopped = renderSequence(layer.childIds, scope.ctx, scope.canvas, localState, activeRegion, activeEnv);
          if (stopped) { scope.release(); return true; }
          if (hit?.layerId === layer.id && !hit.contribution) {
            const contribution = this.borrowCanvas(activeRegion.w, activeRegion.h);
            contribution.ctx.globalAlpha = layer.opacity;
            contribution.ctx.drawImage(scope.canvas,0,0);
            hit.contribution = contribution;
            hit.target = targetCanvas;
          }
          target.save(); resetTarget(target);
          target.globalAlpha = layer.opacity;
          target.globalCompositeOperation = layer.blend;
          target.drawImage(scope.canvas,0,0);
          target.restore();
          if (hit?.target === scope.canvas) hit.target = targetCanvas;
          scope.release();
          state.revision = mixRevision(state.revision, localState.revision);
          continue;
        }
        if (participates(layer)) {
          captureContent(targetCanvas, layer);
          drawLayer(target, layer, activeRegion, activeEnv);
          state.revision = mixRevision(state.revision, `${layer.id}:${eng.getRenderRevision?.(layer.id) ?? 0}`);
        }

      }
      return false;
    };
    const inclusionKey = included ? [...included].sort().join(',') : 'all';
    const initialRevision = mixRevision(2166136261, `${inclusionKey}:${drawToolOverlay ? 'tool' : 'plain'}`);
    renderSequence(roots, artCtx, art.canvas, { revision: initialRevision }, region, env);

    return art;
  }

  private renderEffectContribution(layerId: string, region: RenderRect): CanvasLease {
    const capture = { effectId: layerId, contribution: null as CanvasLease | null };
    const layer = this.engine.layerById(layerId);
    const roots = new SceneQuery(this.engine.getRootLayerIds(), this.engine.allLayers()).members(layer?.parentId ?? null).map(item => item.id);
    const art = this.renderArt(region, null, false, capture, undefined, roots);
    art.release();
    return capture.contribution ?? this.borrowCanvas(region.w, region.h);
  }

  private compositeFull(ctx: CanvasRenderingContext2D, drawToolOverlay: boolean): void {
    const { w, h } = this.engine.artboard;
    const region = { x: 0, y: 0, w, h };
    const art = this.renderArt(region, null, drawToolOverlay);
    this.artCacheCtx.clearRect(0, 0, w, h);
    this.artCacheCtx.drawImage(art.canvas, 0, 0);
    this.present(ctx, this.artCache, region, true);
    this.lastCompositedPixels = w * h;
    art.release();
  }

  private effectPaddingByLayer(env: LayerDrawEnv): Map<string, number> {
    const eng = this.engine;
    const merge = (target: Map<string, number>, source: Map<string, number>) => {
      for (const [id, padding] of source) target.set(id, Math.max(target.get(id) ?? 0, padding));
    };
    const visit = (ids: string[], state: Map<string, number>) => {
      for (const id of ids) {
        const layer = eng.layerById(id);
        if (!layer) continue;
        const effect = layerHandler(layer).renderer.effect;
        if (effect) {
          if (layer.visible) {
            const padding = Math.max(0, effect.paddingPx?.(layer, env) ?? 0);
            if (padding) for (const [sourceId, value] of state) state.set(sourceId, value + padding);
            for (const dependencyId of effect.dependencyLayerIds?.(layer) ?? []) {
              state.set(dependencyId, Math.max(state.get(dependencyId) ?? 0, padding));
            }
          }
          continue;
        }
        if (layer.type === 'canvas') {
          if (!layer.visible) continue;
          const local = new Map<string, number>();
          if (layer.visible) local.set(layer.id, 0);
          visit(layer.childIds, local);
          merge(state, local);
        } else {
          if (layer.visible) state.set(layer.id, Math.max(state.get(layer.id) ?? 0, 0));
        }
      }
    };
    const result = new Map<string, number>();
    visit(eng.getRootLayerIds(), result);
    return result;
  }

  private compositePartial(ctx: CanvasRenderingContext2D, damages: Map<string, DirtyRect>): void {
    const { w, h } = this.engine.artboard;
    const env = this.drawEnv(true);
    const paddingByLayer = this.effectPaddingByLayer(env);
    let output: DirtyRect | null = null;
    let evaluationPadding = 0;
    for (const [layerId, damage] of damages) {
      const padding = paddingByLayer.get(layerId) ?? 0;
      const expanded = expandDirty(damage, padding, w, h);
      output = output ? unionRect(output, expanded) : expanded;
      evaluationPadding = Math.max(evaluationPadding, padding);
    }
    if (!output) return;
    const evaluation = expandDirty(output, evaluationPadding, w, h);
    const outputRegion = asRenderRect(output);
    const evaluationRegion = asRenderRect(evaluation);
    const art = this.renderArt(evaluationRegion, null, true);
    const sx = outputRegion.x - evaluationRegion.x;
    const sy = outputRegion.y - evaluationRegion.y;

    this.artCacheCtx.clearRect(outputRegion.x, outputRegion.y, outputRegion.w, outputRegion.h);
    this.artCacheCtx.drawImage(
      art.canvas,
      sx, sy, outputRegion.w, outputRegion.h,
      outputRegion.x, outputRegion.y, outputRegion.w, outputRegion.h,
    );
    this.present(ctx, this.artCache, outputRegion, false);
    this.lastCompositedPixels = evaluationRegion.w * evaluationRegion.h;
    art.release();
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
      region.x, region.y, region.w, region.h,
      region.x, region.y, region.w, region.h,
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
      a, b, c, d,
      centerX - a * eng.artboard.w / 2 - c * eng.artboard.h / 2,
      centerY - b * eng.artboard.w / 2 - d * eng.artboard.h / 2,
    );
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, eng.artboard.w, eng.artboard.h);
    ctx.clip();
    this.paintToolOverlays(eng, ctx);
    eng.drawActiveShapeHandles(ctx);
    eng.drawLoupeIfAny(ctx);
    ctx.restore();
  }

  private paintToolOverlays(eng: PaintEngine, ctx: CanvasRenderingContext2D): void {
    if (eng.drawToolOverlays) eng.drawToolOverlays(ctx);
    else eng.activeTool().drawOverlay?.(ctx);
  }

  captureBefore(layer: RasterLayer): void {
    const { w, h } = this.engine.artboard;
    this.scratchCtx.clearRect(0, 0, w, h);
    this.scratchCtx.drawImage(layer.runtime.canvas, 0, 0);
  }

  restoreBefore(layer: RasterLayer, rect?: DirtyRect): void {
    const { w, h } = this.engine.artboard;
    layer.runtime.ctx.clearRect(0, 0, w, h);
    layer.runtime.ctx.drawImage(this.scratch, 0, 0);
    this.engine.bumpLayer(layer.id, rect);
  }

  bakeLayerOnto(target: RasterLayer, source: Layer): void {
    const handler = layerHandler(source);
    const env = this.drawEnv(false);
    if (handler.renderer.effect) {
      const borrowed = this.borrowCanvas();
      const scope = borrowed.ctx;
      const { w, h } = this.engine.artboard;
      if (target.visible) layerHandler(target).renderer.draw(scope, target, env);
      handler.renderer.effect.apply({ canvas: borrowed.canvas, coverage: borrowed.canvas, x: 0, y: 0, width: w, height: h, inputRevision: 0 }, source, env);
      target.runtime.ctx.clearRect(0, 0, w, h);
      target.runtime.ctx.drawImage(scope.canvas, 0, 0);
      borrowed.release();
      return;
    }
    handler.renderer.bakeOnto(target, source, env);
  }
}
