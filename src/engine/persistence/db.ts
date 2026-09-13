import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type {
  ToolInstance,
  PageSpec, ProjectFont, ToolLayoutItem, ToolStack,
} from '../../model';
import type { PersistedHistory } from '../history/historyTree';
import type { LayerRecord } from '../layer-types/definition';
import type { HierarchyItem, DocumentAddress } from '../../model';
import { opBytes } from '../history/bytes';
import type { ViewState } from '../view';
import { CLIPBOARD_VERSION, DB_VERSION, PROJECT_VERSION } from './version';
import { migrateClipboard, migrateProjectMeta, migrateSavedPage } from './migrate';
import { validateAppSettings } from './settingsFile';
import type { ShortcutBindings } from '../../shortcuts';

export type SavedLayer = LayerRecord;
export interface SavedPage {
  id: string; pageSpec: PageSpec; rootLayerIds: string[]; hierarchy: HierarchyItem[]; layers: SavedLayer[];
  activeLayerId: string; history: PersistedHistory; view: ViewState;
  thumbnail?: Blob; thumbnailVersion: number;
}
export interface SavedProjectMeta {
  version: typeof PROJECT_VERSION; pageOrder: string[]; activePageId: string; fonts: ProjectFont[];
  binOrder: string[]; lastPagePpi: number;
}
export interface SavedBinItem {
  id: string;
  name: string;
  hierarchy: HierarchyItem[];
  layers: SavedLayer[];
  activeLayerId: string;
  history: PersistedHistory;
  ppi: number;
  visible: boolean;
}
export interface SavedSharedLayerEntity {
  id: string;
  owner: DocumentAddress;
  layer: SavedLayer;
  tombstone: boolean;
}
export interface SavedAppSettings {
  tools: ToolInstance[]; toolLayout: ToolLayoutItem[]; toolStacks: ToolStack[];
  activeToolId: string | null; penColor: string; penSizeMm: number;
  colorHistory: string[]; timelapseEnabled: boolean;
  shortcuts: ShortcutBindings;
}
export interface SavedAppSettingsFile {
  app: 'rin-paint'; kind: 'settings'; version: 1; settings: SavedAppSettings;
}
export interface LayerClipboard { version: typeof CLIPBOARD_VERSION; sourcePageId: string; sourcePageIndex: number; sourcePpi: number; rootIds: string[]; layers: SavedLayer[] }
export interface TimelapseFrame { key?: string; pageId?: string; t: number; blob: Blob }
export interface SavedReferenceImage {
  blob: Blob; name: string; naturalWidth: number; naturalHeight: number; x: number; y: number;
  width: number; rotation: number; opacity: number; locked: boolean;
}

const DB_NAME = 'rin-paint';
let dbPromise: Promise<IDBPDatabase> | null = null;
let activePageId = '';
let projectBytes = 0;
let frameBytes: number | null = null;
let referenceGeneration = 0;
export function referenceEpoch(): number { return referenceGeneration; }
export function setPersistencePageId(id: string): void { activePageId = id; referenceGeneration++; }

function ensureStores(d: IDBPDatabase, tx: IDBPTransaction<unknown, string[], 'versionchange'>): void {
  if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
  if (!d.objectStoreNames.contains('pages')) d.createObjectStore('pages', { keyPath: 'id' });
  if (!d.objectStoreNames.contains('references')) d.createObjectStore('references');
  const frames = d.objectStoreNames.contains('frames')
    ? tx.objectStore('frames')
    : d.createObjectStore('frames', { keyPath: 'key' });
  if (!frames.indexNames.contains('pageId')) frames.createIndex('pageId', 'pageId');
  if (!d.objectStoreNames.contains('clipboard')) d.createObjectStore('clipboard');
  if (!d.objectStoreNames.contains('thumbnails')) d.createObjectStore('thumbnails');
  if (!d.objectStoreNames.contains('bins')) d.createObjectStore('bins', { keyPath: 'id' });
  if (!d.objectStoreNames.contains('entities')) d.createObjectStore('entities', { keyPath: 'id' });
}

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(d, _oldVersion, _newVersion, transaction) {
      ensureStores(d, transaction);
    },
  });
  return dbPromise;
}

function pageBytes(page: SavedPage): number {
  return page.layers.reduce((n, layer) => n + (layer.content?.size ?? 0), 0)
    + page.history.nodes.reduce((n, node) => n + (node.op ? opBytes(node.op) : 0), 0)
    + (page.thumbnail?.size ?? 0);
}
async function refreshProjectBytes(): Promise<void> {
  const d = await db();
  const [meta, pages] = await Promise.all([
    d.get('kv', 'project-meta') as Promise<SavedProjectMeta | undefined>,
    d.getAll('pages') as Promise<SavedPage[]>,
  ]);
  const [bins, entities] = await Promise.all([
    d.getAll('bins') as Promise<SavedBinItem[]>,
    d.getAll('entities') as Promise<SavedSharedLayerEntity[]>,
  ]);
  projectBytes = pages.reduce((n, page) => n + pageBytes(page), 0)
    + bins.reduce((n, item) => n + item.layers.reduce((sum, layer) => sum + (layer.content?.size ?? 0), 0), 0)
    + entities.reduce((n, item) => n + (item.layer.content?.size ?? 0), 0)
    + (meta?.fonts ?? []).reduce((n, font) => n + font.dataUrl.length, 0);
}

export async function saveProjectMeta(meta: SavedProjectMeta): Promise<void> {
  await (await db()).put('kv', meta, 'project-meta');
  void refreshProjectBytes();
}
export async function loadProjectMeta(): Promise<SavedProjectMeta | undefined> {
  const value = await (await db()).get('kv', 'project-meta') as unknown;
  return value === undefined ? undefined : migrateProjectMeta(value);
}
export async function saveAppSettings(settings: SavedAppSettings): Promise<void> {
  await (await db()).put('kv', settings, 'app-settings');
}
export async function loadAppSettings(): Promise<SavedAppSettings | undefined> {
  const value = await (await db()).get('kv', 'app-settings') as unknown;
  if (value === undefined) return undefined;
  return validateAppSettings(value);
}
export async function savePage(page: SavedPage): Promise<void> {
  const d = await db();
  const tx = d.transaction(['pages', 'thumbnails'], 'readwrite');
  void tx.objectStore('pages').put(page);
  if (page.thumbnail) void tx.objectStore('thumbnails').put(page.thumbnail, page.id);
  await tx.done;
  void refreshProjectBytes();
}
export async function loadPage(id: string): Promise<SavedPage | undefined> {
  const value = await (await db()).get('pages', id) as unknown;
  return value === undefined ? undefined : migrateSavedPage(value);
}
export async function loadPageThumbnail(id: string): Promise<Blob | undefined> {
  return await (await db()).get('thumbnails', id) as Blob | undefined;
}

export async function saveBinItem(item: SavedBinItem): Promise<void> {
  await (await db()).put('bins', item);
  void refreshProjectBytes();
}
export async function loadBinItem(id: string): Promise<SavedBinItem | undefined> {
  return await (await db()).get('bins', id) as SavedBinItem | undefined;
}
export async function loadBinItems(): Promise<SavedBinItem[]> {
  return await (await db()).getAll('bins') as SavedBinItem[];
}
export async function deleteBinItem(id: string): Promise<void> {
  await (await db()).delete('bins', id);
  void refreshProjectBytes();
}
export async function saveSharedLayerEntity(entity: SavedSharedLayerEntity): Promise<void> {
  await (await db()).put('entities', entity);
  void refreshProjectBytes();
}
export async function loadSharedLayerEntities(): Promise<SavedSharedLayerEntity[]> {
  return await (await db()).getAll('entities') as SavedSharedLayerEntity[];
}

/** Replace all project data with the given meta and pages. */
export async function replaceProject(
  meta: SavedProjectMeta,
  pages: SavedPage[],
  bins: SavedBinItem[] = [],
  entities: SavedSharedLayerEntity[] = [],
): Promise<void> {
  const d = await db();
  referenceGeneration++;
  const tx = d.transaction(['kv', 'pages', 'references', 'frames', 'clipboard', 'thumbnails', 'bins', 'entities'], 'readwrite');
  await Promise.all([
    tx.objectStore('pages').clear(),
    tx.objectStore('references').clear(),
    tx.objectStore('frames').clear(),
    tx.objectStore('clipboard').clear(),
    tx.objectStore('thumbnails').clear(),
    tx.objectStore('bins').clear(),
    tx.objectStore('entities').clear(),
  ]);
  void tx.objectStore('kv').put(meta, 'project-meta');
  for (const page of pages) {
    void tx.objectStore('pages').put(page);
    if (page.thumbnail) void tx.objectStore('thumbnails').put(page.thumbnail, page.id);
  }
  for (const item of bins) void tx.objectStore('bins').put(item);
  for (const entity of entities) void tx.objectStore('entities').put(entity);
  await tx.done;
  activePageId = meta.activePageId;
  frameBytes = 0;
  await refreshProjectBytes();
}

export async function deletePageData(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['pages', 'references', 'frames', 'thumbnails'], 'readwrite');
  void tx.objectStore('pages').delete(id);
  void tx.objectStore('references').delete(id);
  void tx.objectStore('thumbnails').delete(id);
  const keys = await tx.objectStore('frames').index('pageId').getAllKeys(id);
  for (const key of keys) void tx.objectStore('frames').delete(key);
  await tx.done;
  frameBytes = null;
  void refreshProjectBytes();
}

export async function saveClipboard(value: LayerClipboard): Promise<void> {
  await (await db()).put('clipboard', value, 'layers');
}
export async function loadClipboard(): Promise<LayerClipboard | undefined> {
  const d = await db();
  const value = migrateClipboard(await d.get('clipboard', 'layers'));
  if (value) await d.put('clipboard', value, 'layers');
  else await d.delete('clipboard', 'layers');
  return value;
}
export async function hasClipboard(): Promise<boolean> {
  return !!(await loadClipboard());
}
export async function clearClipboard(): Promise<void> {
  await (await db()).clear('clipboard');
}

export async function saveReferenceImage(image: SavedReferenceImage, generation = referenceGeneration, pageId = activePageId): Promise<void> {
  if (generation !== referenceGeneration || !pageId) return;
  await (await db()).put('references', image, pageId);
}
export async function loadReferenceImage(pageId = activePageId): Promise<SavedReferenceImage | undefined> {
  return await (await db()).get('references', pageId) as SavedReferenceImage | undefined;
}
export async function clearReferenceImage(pageId = activePageId): Promise<void> {
  if (pageId) await (await db()).delete('references', pageId);
}

export async function addFrame(frame: TimelapseFrame, pageId = activePageId): Promise<void> {
  if (!pageId) return;
  const value = { ...frame, key: `${pageId}:${frame.t}:${crypto.randomUUID()}`, pageId };
  await (await db()).put('frames', value);
  frameBytes = null;
}
export async function frameCount(pageId = activePageId): Promise<number> {
  return pageId ? await (await db()).countFromIndex('frames', 'pageId', pageId) : 0;
}
export async function getFrames(pageId = activePageId): Promise<TimelapseFrame[]> {
  return pageId ? await (await db()).getAllFromIndex('frames', 'pageId', pageId) as TimelapseFrame[] : [];
}
export async function thinFramesIfNeeded(max: number, pageId = activePageId): Promise<void> {
  if (!pageId) return;
  const d = await db();
  const entries = await d.getAllFromIndex('frames', 'pageId', pageId) as TimelapseFrame[];
  if (entries.length <= max) return;
  const tx = d.transaction('frames', 'readwrite');
  for (let i = 1; i < entries.length; i += 2) if (entries[i].key) void tx.store.delete(entries[i].key!);
  await tx.done;
  frameBytes = null;
}
async function ensureFrameBytes(): Promise<number> {
  if (frameBytes !== null) return frameBytes;
  frameBytes = (await (await db()).getAll('frames') as TimelapseFrame[]).reduce((n, f) => n + f.blob.size, 0);
  return frameBytes;
}
export interface PersistenceUsage { project: number; timelapse: number; other: number }
export async function getPersistenceUsage(): Promise<PersistenceUsage> {
  const timelapse = await ensureFrameBytes();
  let originUsage = projectBytes + timelapse;
  try { originUsage = (await navigator.storage?.estimate?.())?.usage ?? originUsage; } catch { /* optional */ }
  return { project: projectBytes, timelapse, other: Math.max(0, originUsage - projectBytes - timelapse) };
}
