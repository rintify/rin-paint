import { layerHandler } from '../layer-types/registry';
import type { CanvasLease, LayerDrawEnv } from '../layer-types/types';
import type { Layer } from '../layers';
import type { PaintEngine } from '../PaintEngine';
import type { PixelRect as RenderRect } from '../raster/geometry';
export interface LayerHitCapture {
  layerId: string;
  contribution: CanvasLease | null;
  target: HTMLCanvasElement | null;
}
interface RegionHost {
  engine: PaintEngine;
  borrowCanvas(width: number, height: number): CanvasLease;
  drawEnv(
    tools: boolean,
    width: number,
    height: number,
    x: number,
    y: number,
  ): LayerDrawEnv;
  sequenceVisibleBounds(ids: string[]): RenderRect | null;
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

function mixRevision(current: number, token: string | number): number {
  const value = String(token);
  let hash = current >>> 0;
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export class RegionRenderer {
  constructor(private host: RegionHost) {}

  private hasActiveDirectEffect(
    layer: Layer,
    active: (layer: Layer) => boolean,
  ): boolean {
    const inChain = (id: string): boolean => {
      const child = this.host.engine.layerById(id);
      return (
        !!child && !!layerHandler(child).renderer.effect &&
        (active(child) || child.childIds.some(inChain))
      );
    };
    return layer.childIds.some(inChain);
  }

  /** Layers contributing to the scope immediately before an effect. */
  effectInputLayers(effectId: string, withTools: boolean): Layer[] {
    const eng = this.host.engine;
    const editingTextId = withTools ? eng.getTextEditingId?.() : null;
    const visible = (layer: Layer) =>
      layer.visible &&
      !(layer.type === 'text' && layer.id === editingTextId);
    let result: Layer[] = [];
    const visit = (ids: string[], scope: Layer[]): boolean => {
      for (const id of ids) {
        const layer = eng.layerById(id);
        if (!layer) continue;
        if (id === effectId) {
          result = scope;
          return true;
        }
        if (
          !layerHandler(layer).renderer.effect &&
          this.hasActiveDirectEffect(layer, visible)
        ) {
          const local = visible(layer) ? [layer] : [];
          if (visit(layer.childIds, local)) return true;
          scope.push(...local);
        } else {
          if (visible(layer)) scope.push(layer);
          if (visit(layer.childIds, scope)) return true;
        }
      }
      return false;
    };
    visit(eng.getRootLayerIds(), []);
    return result;
  }

  private drawLayer(
    target: CanvasRenderingContext2D,
    layer: Layer,
    env: LayerDrawEnv,
    originX: number,
    originY: number,
  ): void {
    target.save();
    try {
      target.setTransform(1, 0, 0, 1, -originX, -originY);
      layerHandler(layer).renderer.draw(target, layer, env);
    } finally {
      target.restore();
    }
  }

  /** Native composition writes directly to the persistent paper cache. No scratch copy. */
  renderNativeInto(target: CanvasRenderingContext2D, region: RenderRect): void {
    const eng = this.host.engine;
    const env = this.host.drawEnv(true, region.w, region.h, region.x, region.y);
    const editingTextId = eng.getTextEditingId?.() ?? null;
    const visit = (ids: string[]) => {
      for (const id of ids) {
        const layer = eng.layerById(id);
        if (!layer) continue;
        if (
          layer.visible &&
          !(layer.type === 'text' && layer.id === editingTextId)
        )
          this.drawLayer(target, layer, env, 0, 0);
        visit(layer.childIds);
      }
    };
    target.save();
    try {
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.globalAlpha = 1;
      target.globalCompositeOperation = 'source-over';
      target.filter = 'none';
      target.beginPath();
      target.rect(region.x, region.y, region.w, region.h);
      target.clip();
      target.clearRect(region.x, region.y, region.w, region.h);
      visit(eng.getRootLayerIds());
    } finally {
      target.restore();
    }
  }

  /**
   * Draw visible layers in the current world transform.
   * Used so strokes rasterize at display resolution instead of being upscaled.
   */
  renderNativeInWorld(target: CanvasRenderingContext2D): void {
    const eng = this.host.engine;
    const env = this.host.drawEnv(
      true,
      eng.artboard.w,
      eng.artboard.h,
      0,
      0,
    );
    const editingTextId = eng.getTextEditingId?.() ?? null;
    const visit = (ids: string[]) => {
      for (const id of ids) {
        const layer = eng.layerById(id);
        if (!layer) continue;
        if (
          layer.visible &&
          !(layer.type === 'text' && layer.id === editingTextId)
        ) {
          target.save();
          try {
            layerHandler(layer).renderer.draw(target, layer, env);
          } finally {
            target.restore();
          }
        }
        visit(layer.childIds);
      }
    };
    visit(eng.getRootLayerIds());
  }
  render(
    region: RenderRect,
    included: Set<string> | null,
    drawToolOverlay: boolean,
    capture?: { effectId: string; contribution: CanvasLease | null },
    hit?: LayerHitCapture,
    inputCapture?: { effectId: string; result: CanvasLease | null },
  ): CanvasLease {
    const eng = this.host.engine;
    // The contenteditable text is the synchronous on-canvas preview while typing.
    // Omitting its asynchronously rasterized copy keeps the visible glyphs and
    // the browser caret on the same DOM layout.
    const editingTextId = drawToolOverlay
      ? (eng.getTextEditingId?.() ?? null)
      : null;
    const art = this.host.borrowCanvas(region.w, region.h);
    const artCtx = art.ctx;
    artCtx.save();
    artCtx.setTransform(1, 0, 0, 1, 0, 0);
    artCtx.globalAlpha = 1;
    artCtx.globalCompositeOperation = 'source-over';
    artCtx.filter = 'none';
    artCtx.restore();
    const env = this.host.drawEnv(
      drawToolOverlay,
      region.w,
      region.h,
      region.x,
      region.y,
    );
    const participates = (layer: Layer) =>
      layer.visible &&
      !(layer.type === 'text' && layer.id === editingTextId) &&
      (included === null || included.has(layer.id));
    const resetTarget = (target: CanvasRenderingContext2D) => {
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.globalAlpha = 1;
      target.globalCompositeOperation = 'source-over';
      target.filter = 'none';
    };
    const effectScope = (
      canvas: HTMLCanvasElement,
      inputRevision: number,
      activeRegion: RenderRect,
    ) => ({
      canvas,
      coverage: canvas,
      x: activeRegion.x,
      y: activeRegion.y,
      width: activeRegion.w,
      height: activeRegion.h,
      inputRevision,
    });
    const drawLayer = (
      target: CanvasRenderingContext2D,
      layer: Layer,
      activeRegion: RenderRect,
      activeEnv: LayerDrawEnv,
    ) => {
      this.drawLayer(target, layer, activeEnv, activeRegion.x, activeRegion.y);
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
      const own = this.host.borrowCanvas(region.w, region.h);
      drawLayer(own.ctx, layer, region, env);
      hit.contribution = own;
      hit.target = targetCanvas;
    };
    const captureDifference = (
      targetCanvas: HTMLCanvasElement,
      before: CanvasLease,
    ) => {
      const contribution = this.host.borrowCanvas(region.w, region.h);
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
      const preview = activeEnv.effectPreview;
      const resumeIndex =
        preview && !included && !capture && !hit && !inputCapture
          ? ids.indexOf(preview.layerId)
          : -1;
      if (resumeIndex >= 0 && preview) {
        state.revision = mixRevision(state.revision, preview.revision);
        // This exact upstream scope was captured before the drag. Reuse it instead
        // of replaying all earlier layers and effects for every output tile.
        resetTarget(target);
        target.clearRect(0, 0, activeRegion.w, activeRegion.h);
        target.drawImage(
          preview.source.canvas,
          preview.source.x - activeRegion.x,
          preview.source.y - activeRegion.y,
        );
      }
      for (const id of resumeIndex >= 0 ? ids.slice(resumeIndex) : ids) {
        const layer = eng.layerById(id);
        if (!layer) continue;
        const handler = layerHandler(layer);
        if (handler.renderer.effect) {
          if (inputCapture?.effectId === layer.id) {
            inputCapture.result = this.host.borrowCanvas(region.w, region.h);
            inputCapture.result.ctx.drawImage(
              targetCanvas,
              activeRegion.x - region.x,
              activeRegion.y - region.y,
            );
            return true;
          }
          const capturingEyedropper = capture?.effectId === layer.id;
          const capturingHitEffect =
            !!hit &&
            hit.layerId === layer.id &&
            !!handler.renderer.effect.clickableAddedPixels;
          if (
            participates(layer) ||
            capturingEyedropper ||
            capturingHitEffect
          ) {
            const capturingDifference =
              capturingEyedropper || capturingHitEffect;
            const before = capturingDifference
              ? this.host.borrowCanvas(region.w, region.h)
              : null;
            before?.ctx.drawImage(targetCanvas, 0, 0);
            const frozen =
              activeEnv.effectPreview?.layerId === layer.id
                ? activeEnv.effectPreview.source
                : null;
            const available =
              !frozen && handler.renderer.effect.sourceRegion
                ? this.host.sequenceVisibleBounds(eng.getRootLayerIds())
                : null;
            const requested =
              !frozen &&
              handler.renderer.effect.sourceRegion?.(
                activeRegion,
                layer,
                activeEnv,
                available,
              );
            const sourceBounds =
              requested && available
                ? (intersectBounds(requested, {
                    x: Math.floor(available.x) - 1,
                    y: Math.floor(available.y) - 1,
                    w: Math.ceil(available.w) + 3,
                    h: Math.ceil(available.h) + 3,
                  }) ?? { x: requested.x, y: requested.y, w: 1, h: 1 })
                : requested;
            // Pixel readback needs an integer origin and row stride. Keeping the
            // source grid fixed also makes partial and full rendering agree.
            const sourceRegion = sourceBounds
              ? {
                  x: Math.floor(sourceBounds.x),
                  y: Math.floor(sourceBounds.y),
                  w:
                    Math.ceil(sourceBounds.x + sourceBounds.w) -
                    Math.floor(sourceBounds.x),
                  h:
                    Math.ceil(sourceBounds.y + sourceBounds.h) -
                    Math.floor(sourceBounds.y),
                }
              : sourceBounds;
            let source: CanvasLease | null = null;
            if (sourceRegion) {
              const upstream = {
                effectId: layer.id,
                result: null as CanvasLease | null,
              };
              const unused = this.render(
                sourceRegion,
                included,
                drawToolOverlay,
                undefined,
                undefined,
                upstream,
              );
              unused.release();
              source = upstream.result;
            }
            try {
              handler.renderer.effect.apply(
                {
                  ...effectScope(targetCanvas, state.revision, activeRegion),
                  ...(frozen
                    ? { source: frozen }
                    : source && sourceRegion
                      ? {
                          source: {
                            canvas: source.canvas,
                            x: sourceRegion.x,
                            y: sourceRegion.y,
                            width: sourceRegion.w,
                            height: sourceRegion.h,
                          },
                        }
                      : {}),
                },
                layer,
                activeEnv,
              );
            } finally {
              source?.release();
            }
            resetTarget(target);
            state.revision = mixRevision(
              state.revision,
              `${layer.id}:${eng.getRenderRevision?.(layer.id) ?? 0}`,
            );
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
          if (
            renderSequence(
              layer.childIds,
              target,
              targetCanvas,
              state,
              activeRegion,
              activeEnv,
            )
          )
            return true;
          continue;
        }

        const hasActiveDirectEffect = this.hasActiveDirectEffect(
          layer,
          child => participates(child) || capture?.effectId === child.id || hit?.layerId === child.id,
        );
        if (hasActiveDirectEffect) {
          const measured =
            !capture &&
            !hit &&
            !inputCapture &&
            !eng
              .allLayers()
              .some(
                (item) =>
                  item.visible &&
                  layerHandler(item).renderer.effect?.sourceRegion,
              )
              ? this.host.sequenceVisibleBounds([layer.id])
              : null;
          const clipped = measured
            ? intersectBounds(measured, activeRegion)
            : activeRegion;
          if (!clipped) continue;
          const localRegion = {
            x: Math.floor(clipped.x),
            y: Math.floor(clipped.y),
            w: Math.max(
              1,
              Math.ceil(clipped.x + clipped.w) - Math.floor(clipped.x),
            ),
            h: Math.max(
              1,
              Math.ceil(clipped.y + clipped.h) - Math.floor(clipped.y),
            ),
          };
          const localEnv =
            localRegion.x === activeRegion.x &&
            localRegion.y === activeRegion.y &&
            localRegion.w === activeRegion.w &&
            localRegion.h === activeRegion.h
              ? activeEnv
              : this.host.drawEnv(
                  drawToolOverlay,
                  localRegion.w,
                  localRegion.h,
                  localRegion.x,
                  localRegion.y,
                );
          const localState = {
            revision: mixRevision(
              2166136261,
              `${layer.id}:${eng.getRenderRevision?.(layer.id) ?? 0}`,
            ),
          };
          const scope = this.host.borrowCanvas(localRegion.w, localRegion.h);
          const local = scope.ctx;
          local.save();
          local.setTransform(1, 0, 0, 1, 0, 0);
          resetTarget(local);
          if (participates(layer)) {
            captureContent(scope.canvas, layer);
            drawLayer(local, layer, localRegion, localEnv);
          }
          const stopped = renderSequence(
            layer.childIds,
            local,
            scope.canvas,
            localState,
            localRegion,
            localEnv,
          );
          local.restore();
          if (stopped) {
            scope.release();
            return true;
          }
          target.save();
          resetTarget(target);
          target.drawImage(
            local.canvas,
            localRegion.x - activeRegion.x,
            localRegion.y - activeRegion.y,
          );
          target.restore();
          if (hit?.target === scope.canvas) hit.target = targetCanvas;
          scope.release();
          state.revision = mixRevision(state.revision, localState.revision);
          continue;
        }
        if (participates(layer)) {
          captureContent(targetCanvas, layer);
          drawLayer(target, layer, activeRegion, activeEnv);
          state.revision = mixRevision(
            state.revision,
            `${layer.id}:${eng.getRenderRevision?.(layer.id) ?? 0}`,
          );
        }
        if (
          renderSequence(
            layer.childIds,
            target,
            targetCanvas,
            state,
            activeRegion,
            activeEnv,
          )
        )
          return true;
      }
      return false;
    };
    const inclusionKey = included ? [...included].sort().join(',') : 'all';
    const initialRevision = mixRevision(
      2166136261,
      `${inclusionKey}:${drawToolOverlay ? 'tool' : 'plain'}`,
    );
    renderSequence(
      eng.getRootLayerIds(),
      artCtx,
      art.canvas,
      { revision: initialRevision },
      region,
      env,
    );

    return art;
  }
}
