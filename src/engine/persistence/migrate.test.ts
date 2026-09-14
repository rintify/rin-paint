import { describe, expect, it } from 'vitest';
import {
  migrateClipboard,
  migrateProjectMeta,
  migrateSavedPage,
} from './migrate';
import { CLIPBOARD_VERSION, HISTORY_VERSION, PROJECT_VERSION } from './version';

const line = () => ({
  kind: 'line',
  x1: 0,
  y1: 0,
  x2: 10,
  y2: 10,
  strokeWidth: 5,
  color: '#123456',
});
const rect = () => ({
  kind: 'rect',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  strokeWidth: 2,
  color: '#000',
  paintMode: 'stroke',
});
const common = {
  name: '直線',
  opacity: 1,
  blend: 'source-over',
  visible: true,
  parentId: null,
  childIds: [],
};

describe('v10 project load', () => {
  it('accepts a valid v10 page and keeps history version 8', () => {
    const page = migrateSavedPage({
      id: 'p',
      pageSpec: { widthMm: 10, heightMm: 10, ppi: 300 },
      rootLayerIds: ['l'],
      activeLayerId: 'l',
      layers: [
        {
          id: 'l',
          type: 'shape',
          common: { ...common },
          state: { shape: line(), snapEnabled: true },
        },
      ],
      history: {
        version: HISTORY_VERSION,
        rootId: 0,
        currentId: 0,
        nodes: [
          {
            id: 0,
            label: '開始',
            op: null,
            parentId: null,
            childIds: [],
            lastChild: 0,
          },
        ],
      },
      view: { x: 0, y: 0, scale: 1, rot: 0 },
      thumbnailVersion: 0,
    });
    expect(page.history.version).toBe(HISTORY_VERSION);
    expect(page.layers[0].state).toMatchObject({
      shape: { kind: 'line', strokeWidth: 5 },
    });
  });

  it('rejects legacy project meta versions', () => {
    expect(() =>
      migrateProjectMeta({
        version: 9,
        pageOrder: ['p'],
        activePageId: 'p',
        fonts: [],
      }),
    ).toThrow(/対応していない/);
    expect(() =>
      migrateProjectMeta({
        version: 7,
        pageOrder: ['p'],
        activePageId: 'p',
        fonts: [],
      }),
    ).toThrow(/対応していない/);
  });

  it('keeps project meta independent and accepts current clipboard envelopes', () => {
    const meta = migrateProjectMeta({
      version: PROJECT_VERSION,
      pageOrder: ['p'],
      activePageId: 'p',
      fonts: [],
    });
    expect(meta.version).toBe(PROJECT_VERSION);
    const clipboard = migrateClipboard({
      version: CLIPBOARD_VERSION,
      sourcePageId: 'p',
      sourcePageIndex: 0,
      sourcePpi: 300,
      rootIds: ['l'],
      layers: [
        {
          id: 'l',
          type: 'shape',
          common: { ...common, name: '四角形' },
          state: { shape: rect(), snapEnabled: true },
        },
      ],
    });
    expect(clipboard?.layers[0].state).toMatchObject({
      shape: { paintMode: 'stroke' },
    });
  });
});
