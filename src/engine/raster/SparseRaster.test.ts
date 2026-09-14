import { drawShape } from '../shapes';
// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { createCanvas, loadImage, Path2D, type Canvas } from '@napi-rs/canvas';
import { Blob as NodeBlob } from 'node:buffer';
import { RasterSurface, RasterEditSession } from './RasterSurface';
import { RasterResampler } from './RasterResampler';
import { RasterSelectionContent } from './RasterSelectionContent';
import {
  assetBlobs,
  rasterStats,
  releaseUnusedCanvases,
} from './RasterAssetRepository';
import { createRasterLayer } from '../layers';
import { stampRasterSegment } from '../brush';
import {
  savePage,
  loadPage,
  replaceProject,
  collectUnusedRasterAssets,
  saveClipboard,
  loadClipboard,
} from '../persistence/db';
import { HistoryTree } from '../history/historyTree';
import { PROJECT_VERSION, CLIPBOARD_VERSION } from '../persistence/version';
import { packProjectFile, unpackProjectFile } from '../persistence/projectFile';
import { traceSparseAlphaContours } from '../layer-types/effectUtils';
const native = new WeakMap<HTMLCanvasElement, Canvas>();
function backing(c: HTMLCanvasElement): Canvas {
  let n = native.get(c);
  if (!n) {
    n = createCanvas(c.width, c.height);
    native.set(c, n);
  }
  if (n.width !== c.width) n.width = c.width;
  if (n.height !== c.height) n.height = c.height;
  return n;
}
beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('Path2D', Path2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    function (this: HTMLCanvasElement) {
      const node = this,
        ctx = backing(node).getContext('2d');
      return new Proxy(ctx, {
        get(t, k) {
          if (k === 'canvas') return node;
          if (k === 'drawImage')
            return (source: HTMLCanvasElement | Canvas, ...args: number[]) =>
              (t.drawImage as Function)(
                source instanceof HTMLCanvasElement ? backing(source) : source,
                ...args,
              );
          const v = Reflect.get(t, k, t);
          return typeof v === 'function' ? v.bind(t) : v;
        },
        set(t, k, v) {
          return Reflect.set(t, k, v, t);
        },
      }) as unknown as CanvasRenderingContext2D;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
  ) {
    void backing(this)
      .encode('png')
      .then((b) => cb(new Blob([new Uint8Array(b)])));
  });
  vi.stubGlobal('createImageBitmap', async (blob: Blob) =>
    Object.assign(await loadImage(new Uint8Array(await blob.arrayBuffer())), {
      close() {},
    }),
  );
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const read = (s: RasterSurface, x: number, y: number) => [
  ...s.readRegion({ x, y, w: 1, h: 1 }).data,
];
function dot(s: RasterSurface, x: number, y: number, color = '#ff0000') {
  const edit = new RasterEditSession(s);
  edit.mutateRegion({ x, y, w: 1, h: 1 }, (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  });
  return edit.commit();
}
const rectCorners = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
describe('sparse raster storage and transactions', () => {
  it('uses one mesh and one edge owner across clipped transform tiles', () => {
    const source = new RasterSurface(),
      input = new RasterEditSession(source);
    input.mutateRegion({ x: 0, y: 0, w: 64, h: 64 }, (ctx) => {
      ctx.fillStyle = 'rgba(255,0,0,0.5)';
      ctx.fillRect(0, 0, 64, 64);
    });
    input.commit();
    const corners = [
        { x: -30, y: 0 },
        { x: 310, y: 30 },
        { x: 280, y: 90 },
        { x: -20, y: 64 },
      ],
      rect = { x: 0, y: 0, w: 64, h: 64 };
    const full = new RasterSurface(),
      fullEdit = new RasterEditSession(full);
    RasterResampler.draw(source, rect, corners, fullEdit);
    fullEdit.commit();
    const split = new RasterSurface(),
      splitEdit = new RasterEditSession(split);
    for (const x of [-256, 0, 256])
      RasterResampler.draw(source, rect, corners, splitEdit, {
        x,
        y: 0,
        w: 256,
        h: 256,
      });
    splitEdit.commit();
    expect(split.readRegion({ x: -32, y: 0, w: 350, h: 100 }).data).toEqual(
      full.readRegion({ x: -32, y: 0, w: 350, h: 100 }).data,
    );
    for (const x of [254, 255, 256, 257])
      expect(read(full, x, 50)[3]).toBe(127);
  });
  it('retains immutable pixels after a failed PNG encode and retries', async () => {
    const surface = new RasterSurface();
    dot(surface, -1, 0);
    const snapshot = surface.snapshot();
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce((cb) =>
      cb(null),
    );
    await expect(assetBlobs(snapshot)).rejects.toThrow();
    expect(read(surface, -1, 0)).toEqual([255, 0, 0, 255]);
    expect(Object.keys(await assetBlobs(snapshot))).toHaveLength(1);
  });
  it('rolls back every touched tile when a drawing callback fails', () => {
    const surface = new RasterSurface();
    dot(surface, -1, 0);
    const before = surface.snapshot();
    const edit = new RasterEditSession(surface);
    expect(() =>
      edit.mutateRegion({ x: -1, y: 0, w: 258, h: 1 }, (ctx, r) => {
        ctx.fillRect(r.x, 0, 256, 1);
        if (r.x === 256) throw new Error('allocation');
      }),
    ).toThrow('allocation');
    expect(surface.snapshot()).toEqual(before);
    expect(read(surface, -1, 0)).toEqual([255, 0, 0, 255]);
  });
  it('keeps outside shape fill finite and preserves existing off-paper pixels', () => {
    const surface = new RasterSurface();
    dot(surface, -5, -5);
    const edit = new RasterEditSession(surface);
    edit.mutateRegion({ x: -16, y: -16, w: 64, h: 64 }, (ctx) =>
      drawShape(
        ctx,
        {
          kind: 'rect',
          x: -10,
          y: -10,
          width: 20,
          height: 20,
          color: '#00ff00',
          strokeWidth: 0,
          paintMode: 'fill-outside',
        },
        false,
        { w: 32, h: 32 },
      ),
    );
    edit.commit();
    expect(read(surface, -5, -5)).toEqual([255, 0, 0, 255]);
    expect(read(surface, 20, 20)).toEqual([0, 255, 0, 255]);
    expect(read(surface, 33, 20)[3]).toBe(0);
  });
  it('allocates no pixel buffers for 100 empty layers', () => {
    expect(
      Array.from({ length: 100 }, () =>
        createRasterLayer('empty', 4096, 4096),
      ).reduce((n, l) => n + l.runtime.surface.tileCount, 0),
    ).toBe(0);
  });
  it('reads and restores negative tile coordinates and the origin', async () => {
    const s = new RasterSurface();
    for (const x of [-257, -256, -1, 0, 255, 256]) {
      const change = dot(s, x, x);
      expect(read(s, x, x)).toEqual([255, 0, 0, 255]);
      await s.apply(change.tiles, 'before');
      expect(read(s, x, x)[3]).toBe(0);
      await s.apply(change.tiles, 'after');
      expect(read(s, x, x)[3]).toBe(255);
    }
  });
  it('does not allocate the gap between distant pixels and copies only touched tiles', () => {
    const s = new RasterSurface();
    dot(s, 20, 20);
    dot(s, 1_000_020, 20);
    expect(s.tileCount).toBe(2);
    const before = rasterStats.copiedPixels;
    dot(s, 21, 20);
    expect(rasterStats.copiedPixels - before).toBe(256 * 256);
    expect(s.tileCount).toBe(2);
  });
  it('shares snapshots without editing their pixels and removes fully erased tiles', async () => {
    const s = new RasterSurface();
    dot(s, -1, -1);
    const copy = s.clone(),
      id = s.snapshot().tiles[0].assetId;
    const edit = new RasterEditSession(s);
    edit.mutateRegion({ x: -1, y: -1, w: 1, h: 1 }, (ctx) =>
      ctx.clearRect(-1, -1, 1, 1),
    );
    const change = edit.commit();
    expect(s.tileCount).toBe(0);
    expect(read(copy, -1, -1)[3]).toBe(255);
    expect(change.tiles[0]).toMatchObject({
      tx: -1,
      ty: -1,
      before: id,
      after: null,
    });
    await s.apply(change.tiles, 'before');
    expect(read(s, -1, -1)[3]).toBe(255);
  });
  it('cancels created tiles and resets the before image for taper repaint', () => {
    const s = new RasterSurface();
    dot(s, 0, 0);
    const edit = new RasterEditSession(s);
    edit.mutateRegion({ x: -1, y: -1, w: 2, h: 2 }, (ctx) => {
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(-1, -1, 2, 2);
    });
    edit.resetToBefore();
    expect(s.tileCount).toBe(1);
    expect(read(s, 0, 0)).toEqual([255, 0, 0, 255]);
    edit.mutateRegion({ x: 0, y: 0, w: 1, h: 1 }, (ctx) =>
      ctx.clearRect(0, 0, 1, 1),
    );
    edit.cancel();
    expect(read(s, 0, 0)[3]).toBe(255);
  });
  it('keeps empty erasing sparse and draws a diagonal through only touched tiles', () => {
    const s = new RasterSurface(),
      edit = new RasterEditSession(s);
    stampRasterSegment(edit, -100, -100, 3, 100, 100, 3, 'transparent', true);
    expect(edit.commit().tiles).toHaveLength(0);
    const draw = new RasterEditSession(s);
    stampRasterSegment(draw, -600, -600, 2, 600, 600, 2, '#ff0000', false);
    draw.commit();
    expect(s.tileCount).toBeLessThan(20);
    expect(read(s, 0, 0)[3]).toBe(255);
  });
  it('checks world bounds before writing', () => {
    const s = new RasterSurface(),
      edit = new RasterEditSession(s);
    expect(() =>
      edit.mutateRegion({ x: 2 ** 30, y: 0, w: 1, h: 1 }, () => {}),
    ).toThrow();
    expect(s.tileCount).toBe(0);
  });
  it('preserves neighboring off-paper pixels on region replacement', () => {
    const s = new RasterSurface();
    dot(s, 99, 20);
    dot(s, 100, 20);
    const image = s.readRegion({ x: 99, y: 20, w: 1, h: 1 });
    image.data.fill(0);
    const edit = new RasterEditSession(s);
    edit.replaceRegion({ x: 99, y: 20, w: 1, h: 1 }, image);
    edit.commit();
    expect(read(s, 99, 20)[3]).toBe(0);
    expect(read(s, 100, 20)[3]).toBe(255);
  });
});
describe('sparse selection and resampling', () => {
  it('moves isolated pixels a million pixels away without allocating a bounding image', () => {
    const s = new RasterSurface();
    dot(s, 0, 0);
    dot(s, 1_000_000, 0);
    const target = new RasterSurface(),
      edit = new RasterEditSession(target),
      r = s.getContentBounds()!;
    RasterResampler.draw(
      s,
      r,
      rectCorners(r.x - 500, r.y - 500, r.w, r.h),
      edit,
    );
    edit.commit();
    expect(target.tileCount).toBe(2);
    expect(read(target, -500, -500)[3]).toBe(255);
    expect(read(target, 999500, -500)[3]).toBe(255);
  });
  it('selects a single negative pixel and restores it on cancellation', () => {
    const s = new RasterSurface();
    dot(s, -1, -1);
    const edit = new RasterEditSession(s),
      r = { x: -1, y: -1, w: 1, h: 1 };
    const c = RasterSelectionContent.extract(
      s,
      r,
      (ctx) => {
        ctx.beginPath();
        ctx.rect(-1, -1, 1, 1);
      },
      edit,
    );
    expect(read(c.surface, -1, -1)[3]).toBe(255);
    expect(read(s, -1, -1)[3]).toBe(0);
    edit.cancel();
    expect(read(s, -1, -1)[3]).toBe(255);
  });
  it('scales across a tile seam with consistent alpha and keeps negative content', () => {
    const s = new RasterSurface(),
      edit = new RasterEditSession(s);
    edit.mutateRegion({ x: -2, y: -2, w: 260, h: 4 }, (ctx) => {
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(-2, -2, 260, 4);
    });
    edit.commit();
    const scaled = RasterResampler.scale(s, 2);
    for (const x of [-2, 0, 254, 255, 256, 257, 510, 511, 512])
      expect(read(scaled, x, 0)).toEqual([0, 255, 0, 255]);
  });
  it('joins sharp outlines across negative and positive tile boundaries', () => {
    const s = new RasterSurface(),
      edit = new RasterEditSession(s);
    edit.mutateRegion({ x: -300, y: -5, w: 600, h: 10 }, (ctx) =>
      ctx.fillRect(-300, -5, 600, 10),
    );
    edit.commit();
    const contours = traceSparseAlphaContours(s, 127);
    expect(contours).toHaveLength(1);
    expect(contours[0].length).toBeLessThan(15);
  });
});
describe('raster persistence', () => {
  it('encodes only changed versions and restores pixels from PNG assets', async () => {
    const s = new RasterSurface();
    dot(s, -1, 0);
    dot(s, 1000000, 0);
    const snapshot = s.snapshot(),
      before = rasterStats.encodedTiles;
    await assetBlobs(snapshot);
    expect(rasterStats.encodedTiles - before).toBe(2);
    await assetBlobs(snapshot);
    expect(rasterStats.encodedTiles - before).toBe(2);
    dot(s, 1000000, 1);
    await assetBlobs(s.snapshot());
    expect(rasterStats.encodedTiles - before).toBe(3);
    releaseUnusedCanvases(new Set(), 0);
    const restored = await RasterSurface.restore(snapshot);
    expect(read(restored, -1, 0)).toEqual([255, 0, 0, 255]);
    expect(read(restored, 1000000, 0)[3]).toBe(255);
    expect(read(restored, 1000000, 1)[3]).toBe(0);
  });
  it('roundtrips page, branches, project file and clipboard without losing external tiles', async () => {
    const surface = new RasterSurface(),
      a = dot(surface, -300, 10),
      history = new HistoryTree();
    history.push({ kind: 'raster', layerId: 'l', tiles: a.tiles }, 'a');
    const b = dot(surface, 1000000, 10);
    history.push({ kind: 'raster', layerId: 'l', tiles: b.tiles }, 'b');
    history.undo();
    await surface.apply(b.tiles, 'before');
    const c = dot(surface, -500, 10);
    history.push({ kind: 'raster', layerId: 'l', tiles: c.tiles }, 'c');
    const layer = {
      id: 'l',
      type: 'raster' as const,
      common: {
        name: 'layer',
        opacity: 1,
        blend: 'source-over' as const,
        visible: true,
        parentId: null,
        childIds: [],
      },
      state: {},
      content: surface.snapshot(),
    };
    const page = {
      id: 'p',
      pageSpec: { widthMm: 10, heightMm: 10, ppi: 300 },
      layers: [layer],
      rootLayerIds: ['l'],
      activeLayerId: 'l',
      history: await history.serialize(async () => new Blob()),
      view: { x: 0, y: 0, scale: 1, rot: 0 },
      thumbnailVersion: 0,
    };
    const meta = {
      version: PROJECT_VERSION,
      pageOrder: ['p'],
      activePageId: 'p',
      fonts: [],
    };
    await replaceProject(meta, [page]);
    await savePage(page, meta);
    const loaded = (await loadPage('p'))!;
    const content = loaded.layers[0].content;
    if (!content || content instanceof Blob)
      throw new Error('missing tiled content');
    const restored = await RasterSurface.restore(content);
    expect(read(restored, -300, 10)[3]).toBe(255);
    expect(read(restored, -500, 10)[3]).toBe(255);
    const h = new HistoryTree();
    h.restore(loaded.history);
    h.undo();
    expect(h.current.children).toHaveLength(2);
    await saveClipboard({
      version: CLIPBOARD_VERSION,
      sourcePageId: 'p',
      sourcePageIndex: 0,
      sourcePpi: 300,
      rootIds: ['l'],
      layers: [layer],
    });
    await collectUnusedRasterAssets();
    expect((await loadClipboard())?.layers[0].content).toEqual(layer.content);
    const file = await packProjectFile({
      app: 'rin-paint',
      version: PROJECT_VERSION,
      meta,
      pages: [page],
    });
    const unpacked = await unpackProjectFile(file);
    expect(unpacked.pages[0].history.nodes).toHaveLength(4);
    expect(Object.keys(unpacked.rasterAssets!)).toHaveLength(3);
  });
});
