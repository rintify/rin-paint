import { layerHandler } from '../layer-types/registry';
import type { CanvasLease, LayerDrawEnv, LayerMeasureEnv } from '../layer-types/types';
import { makeCanvas, type Layer, type RasterLayer } from '../layers';
import { TextRenderer } from '../text/render';
import type { PaintEngine } from '../PaintEngine';
import { CanvasPool } from './CanvasPool';
import { MaskRenderer } from './MaskRenderer';
import { unionRect, type DirtyRect } from '../brush';
import { EffectCache } from './EffectCache';

interface RenderRect { x: number; y: number; w: number; h: number }

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
    return { artboard: this.engine.artboard, textRenderer: this.textRenderer };
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
      originX,
      originY,
      textRenderer: this.textRenderer,
      layerById: (id) => eng.layerById(id),
      handlerFor: layerHandler,
      borrowCanvas: (w = width, h = height) => this.borrowCanvas(w, h),
      borrowReadbackCanvas: (w = width, h = height) => this.borrowReadbackCanvas(w, h),
      ppi: eng.getCanvasSpec().ppi,
      maskCanvas: (ids) => this.maskRenderer.render(
        ids,
        env,
        id => eng.getMaskRevision?.(id) ?? 0,
      ),
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
    this.textRenderer.retain(new Set(layers.filter(l => l.type === 'text').map(l => l.id)));
    for (const layer of layers) if (layer.type === 'text') {
      this.textRenderer.request(layer.id, layer.text, this.engine.getCanvasSpec().ppi, () => {
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

  attachCanvases(main: HTMLCanvasElement, overlay: HTMLCanvasElement): void {
    this.main = main;
    this.mainCtx = main.getContext('2d')!;
    this.overlayCtx = overlay.getContext('2d')!;
  }

  detachCanvases(): void {
    this.stopLoop();
    this.main = null;
    this.mainCtx = null;
    this.overlayCtx = null;
  }

  private loop = (): void => {
    this.raf = 0;
    if (this.dirty) this.composite();
    if (this.overlayDirty || this.engine.activeTool().overlayAnimated?.()) {
      this.drawOverlayFrame();
      this.overlayDirty = false;
    }
    if (this.engine.activeTool().overlayAnimated?.()) this.scheduleFrame();
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
    const art = this.renderArt({ x: 0, y: 0, w, h }, ids, false);
    this.present(this.fillReferenceCtx, art.canvas, { x: 0, y: 0, w, h }, true);
    art.release();
    return this.fillReference;
  }

  private renderArt(
    region: RenderRect,
    included: Set<string> | null,
    drawToolOverlay: boolean,
  ): CanvasLease {
    const eng = this.engine;
    const art = this.borrowCanvas(region.w, region.h);
    const artCtx = art.ctx;
    artCtx.save();
    artCtx.setTransform(1, 0, 0, 1, 0, 0);
    artCtx.globalAlpha = 1;
    artCtx.globalCompositeOperation = 'source-over';
    artCtx.filter = 'none';
    artCtx.restore();
    const env = this.drawEnv(drawToolOverlay, region.w, region.h, region.x, region.y);
    const participates = (layer: Layer) => layer.visible && (included === null || included.has(layer.id));
    const activeEffectInChain = (layer: Layer): boolean => {
      if (!layerHandler(layer).effect) return false;
      if (participates(layer)) return true;
      return layer.childIds.some(id => {
        const child = eng.layerById(id);
        return !!child && activeEffectInChain(child);
      });
    };
    const resetTarget = (target: CanvasRenderingContext2D) => {
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.globalAlpha = 1;
      target.globalCompositeOperation = 'source-over';
      target.filter = 'none';
    };
    const effectScope = (canvas: HTMLCanvasElement, inputRevision: number) => ({
      canvas,
      coverage: canvas,
      x: region.x,
      y: region.y,
      width: region.w,
      height: region.h,
      inputRevision,
    });
    const drawLayer = (target: CanvasRenderingContext2D, layer: Layer) => {
      target.save();
      target.setTransform(1, 0, 0, 1, -region.x, -region.y);
      layerHandler(layer).draw(target, layer, env);
      target.restore();
    };
    const renderSequence = (
      ids: string[],
      target: CanvasRenderingContext2D,
      targetCanvas: HTMLCanvasElement,
      state: { revision: number },
    ) => {
      for (const id of ids) {
        const layer = eng.layerById(id);
        if (!layer) continue;
        const handler = layerHandler(layer);
        if (handler.effect) {
          if (participates(layer)) {
            handler.effect.apply(effectScope(targetCanvas, state.revision), layer, env);
            resetTarget(target);
            state.revision = mixRevision(state.revision, `${layer.id}:${eng.getRenderRevision?.(layer.id) ?? 0}`);
          }
          renderSequence(layer.childIds, target, targetCanvas, state);
          continue;
        }

        const hasActiveDirectEffect = layer.childIds.some(childId => {
          const child = eng.layerById(childId);
          return !!child && activeEffectInChain(child);
        });
        if (hasActiveDirectEffect) {
          const localState = {
            revision: mixRevision(2166136261, `${layer.id}:${eng.getRenderRevision?.(layer.id) ?? 0}`),
          };
          const scope = this.borrowCanvas(region.w, region.h);
          const local = scope.ctx;
          local.save();
          local.setTransform(1, 0, 0, 1, 0, 0);
          resetTarget(local);
          if (participates(layer)) {
            drawLayer(local, layer);
          }
          renderSequence(layer.childIds, local, scope.canvas, localState);
          local.restore();
          target.save();
          resetTarget(target);
          target.drawImage(local.canvas, 0, 0);
          target.restore();
          scope.release();
          state.revision = mixRevision(state.revision, localState.revision);
          continue;
        }
        if (participates(layer)) {
          drawLayer(target, layer);
          state.revision = mixRevision(state.revision, `${layer.id}:${eng.getRenderRevision?.(layer.id) ?? 0}`);
        }
        renderSequence(layer.childIds, target, targetCanvas, state);
      }
    };
    const inclusionKey = included ? [...included].sort().join(',') : 'all';
    const initialRevision = mixRevision(2166136261, `${inclusionKey}:${drawToolOverlay ? 'tool' : 'plain'}`);
    renderSequence(eng.getRootLayerIds(), artCtx, art.canvas, { revision: initialRevision });

    return art;
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
    const activeEffectInChain = (layer: Layer): boolean => {
      const effect = layerHandler(layer).effect;
      if (effect && layer.visible) return true;
      return layer.childIds.some(id => {
        const child = eng.layerById(id);
        return !!child && activeEffectInChain(child);
      });
    };
    const merge = (target: Map<string, number>, source: Map<string, number>) => {
      for (const [id, padding] of source) target.set(id, Math.max(target.get(id) ?? 0, padding));
    };
    const visit = (ids: string[], state: Map<string, number>) => {
      for (const id of ids) {
        const layer = eng.layerById(id);
        if (!layer) continue;
        const effect = layerHandler(layer).effect;
        if (effect) {
          if (layer.visible) {
            const padding = Math.max(0, effect.paddingPx?.(layer, env) ?? 0);
            if (padding) for (const [sourceId, value] of state) state.set(sourceId, value + padding);
            for (const dependencyId of effect.dependencyLayerIds?.(layer) ?? []) {
              state.set(dependencyId, Math.max(state.get(dependencyId) ?? 0, padding));
            }
          }
          visit(layer.childIds, state);
          continue;
        }
        if (layer.childIds.some(childId => {
          const child = eng.layerById(childId);
          return !!child && activeEffectInChain(child);
        })) {
          const local = new Map<string, number>();
          if (layer.visible) local.set(layer.id, 0);
          visit(layer.childIds, local);
          merge(state, local);
        } else {
          if (layer.visible) state.set(layer.id, Math.max(state.get(layer.id) ?? 0, 0));
          visit(layer.childIds, state);
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
    const ctx = this.overlayCtx;
    if (!ctx) return;
    const eng = this.engine;
    ctx.clearRect(0, 0, eng.artboard.w, eng.artboard.h);
    eng.activeTool().drawOverlay?.(ctx);
    eng.drawActiveShapeHandles(ctx);
    eng.drawLoupeIfAny(ctx);
  }

  captureBefore(layer: RasterLayer): void {
    const { w, h } = this.engine.artboard;
    this.scratchCtx.clearRect(0, 0, w, h);
    this.scratchCtx.drawImage(layer.canvas, 0, 0);
  }

  restoreBefore(layer: RasterLayer, rect?: DirtyRect): void {
    const { w, h } = this.engine.artboard;
    layer.ctx.clearRect(0, 0, w, h);
    layer.ctx.drawImage(this.scratch, 0, 0);
    this.engine.bumpLayer(layer.id, rect);
  }

  bakeLayerOnto(target: RasterLayer, source: Layer): void {
    const handler = layerHandler(source);
    const env = this.drawEnv(false);
    if (handler.effect) {
      const borrowed = this.borrowCanvas();
      const scope = borrowed.ctx;
      const { w, h } = this.engine.artboard;
      if (target.visible) layerHandler(target).draw(scope, target, env);
      handler.effect.apply({ canvas: borrowed.canvas, coverage: borrowed.canvas, x: 0, y: 0, width: w, height: h, inputRevision: 0 }, source, env);
      target.ctx.clearRect(0, 0, w, h);
      target.ctx.drawImage(scope.canvas, 0, 0);
      borrowed.release();
      return;
    }
    handler.bakeOnto(target, source, env);
  }
}
