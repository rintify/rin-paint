// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../state/store';
import { loadClipboard, type LayerClipboard, type SavedLayer } from '../persistence/db';
import { CLIPBOARD_VERSION } from '../persistence/version';
import type { PaintEngine } from '../PaintEngine';
import { ClipboardService } from './ClipboardService';

vi.mock('../persistence/db', () => ({
  loadClipboard: vi.fn(),
  saveClipboard: vi.fn(),
}));

vi.mock('../layer-types/registry', () => ({
  savedLayerFrom: vi.fn(),
  scaleStoredLayer: vi.fn(),
  remapRecordIds: vi.fn((record: { id: string }, remap: (id: string) => string | undefined) => {
    record.id = remap(record.id) ?? record.id;
  }),
}));

const source = {
  id: 'source',
  type: 'shape',
  common: { name: 'Source', parentId: null, childIds: [] },
} as unknown as SavedLayer;

function setup() {
  const createPasteLink = vi.fn();
  const restoredSnapshots: SavedLayer[] = [];
  const snapshotLayer = vi.fn((layer: { id: string }) => ({
    ...source,
    id: layer.id,
    common: { ...source.common, parentId: null, childIds: [] },
  }));
  const engine = {
    isBusy: () => false,
    getPageSpec: () => ({ ppi: 300 }),
    pages: { activePageId: 'page', pageOrder: ['page'] },
    artboard: {},
    layerService: {
      activeLayerId: 'active',
      rootLayerIds: ['active'],
      locationOf: () => ({ parentId: null, index: 0 }),
      byId: () => undefined,
      restoreLayer: vi.fn(async (snapshot: SavedLayer) => {
        restoredSnapshots.push(structuredClone(snapshot));
        return { id: snapshot.id };
      }),
      snapshotLayer,
    },
    links: { createPasteLink },
    history: { push: vi.fn() },
    committed: vi.fn(),
  } as unknown as PaintEngine;
  return { service: new ClipboardService(engine), createPasteLink, restoredSnapshots };
}

describe('ClipboardService paste linking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadClipboard).mockResolvedValue({
      version: CLIPBOARD_VERSION,
      sourcePageId: 'source-page',
      sourcePageIndex: 0,
      sourcePpi: 300,
      rootIds: ['source'],
      layers: [source],
    } satisfies LayerClipboard);
  });

  it.each([
    [false, 0],
    [true, 1],
  ])('creates a paste link only when the preference is %s', async (enabled, expectedCalls) => {
    useStore.getState().set({ autoLinkOnPaste: enabled });
    const { service, createPasteLink } = setup();

    await service.pasteLayers();

    expect(createPasteLink).toHaveBeenCalledTimes(expectedCalls);
  });

  it('preserves an existing link instead of replacing it with an automatic paste link', async () => {
    const linked = structuredClone(source);
    linked.common.parameterLink = {
      source: { pageId: 'other-page', layerId: 'external' },
      sourceNameHint: 'External',
      sourcePageIndexHint: 2,
      linkedParameterIds: ['appearance.color'],
    };
    vi.mocked(loadClipboard).mockResolvedValue({
      version: CLIPBOARD_VERSION,
      sourcePageId: 'source-page',
      sourcePageIndex: 0,
      sourcePpi: 300,
      rootIds: ['source'],
      layers: [linked],
    });
    useStore.getState().set({ autoLinkOnPaste: true });
    const { service, createPasteLink, restoredSnapshots } = setup();

    await service.pasteLayers();

    expect(createPasteLink).not.toHaveBeenCalled();
    expect(restoredSnapshots[0]?.common.parameterLink).toEqual(linked.common.parameterLink);
  });

  it('remaps a copied internal link to the pasted source layer', async () => {
    const internalSource = {
      ...structuredClone(source),
      id: 'internal-source',
      common: { ...structuredClone(source.common), name: 'Internal source' },
    };
    const internalTarget = {
      ...structuredClone(source),
      id: 'internal-target',
      common: {
        ...structuredClone(source.common),
        name: 'Internal target',
        parameterLink: {
          source: { pageId: 'source-page', layerId: 'internal-source' },
          sourceNameHint: 'Internal source',
          sourcePageIndexHint: 4,
          linkedParameterIds: ['appearance.color'],
        },
      },
    };
    vi.mocked(loadClipboard).mockResolvedValue({
      version: CLIPBOARD_VERSION,
      sourcePageId: 'source-page',
      sourcePageIndex: 4,
      sourcePpi: 300,
      rootIds: ['internal-source', 'internal-target'],
      layers: [internalSource, internalTarget],
    });
    useStore.getState().set({ autoLinkOnPaste: false });
    const { service, restoredSnapshots } = setup();

    await service.pasteLayers();

    const pastedSource = restoredSnapshots.find(item => item.common.name === 'Internal source')!;
    const pastedTarget = restoredSnapshots.find(item => item.common.name === 'Internal target')!;
    expect(pastedTarget.common.parameterLink?.source).toEqual({
      pageId: 'page',
      layerId: pastedSource.id,
    });
    expect(pastedTarget.common.parameterLink?.linkedParameterIds).toEqual(['appearance.color']);
  });
});
