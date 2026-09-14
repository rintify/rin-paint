import {prepareDocument, putDocument, readDocument, deleteDocument, resourceBytes, clearResources} from './resourceStorage';
import { isSavedBin } from './schema';
import type { DocumentKey } from '../../model/document/types';
import type { LayerStack } from '../../model/layerStack';
import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type {
  ToolInstance,
  PageSpec, ProjectFont, ToolLayoutItem, ToolStack,
} from '../../model';
import type { PersistedHistory } from '../history/historyTree';
import type { LayerRecord } from '../layer-types/definition';
import type { ViewState } from '../view';
import { CLIPBOARD_VERSION, DB_VERSION, PROJECT_VERSION } from './version';
import { migrateClipboard, migrateProjectMeta, migrateSavedPage } from './migrate';
import { validateAppSettings } from './settingsFile';
import type { ShortcutBindings } from '../../shortcuts';

export type SavedLayer = LayerRecord;
export interface SavedPage {
  layerStacks?: LayerStack[];
  selection?: {selectedLayerIds:string[];multiSelectMode:boolean};
  id: string; pageSpec: PageSpec; rootLayerIds: string[]; layers: SavedLayer[];
  activeLayerId: string; history: PersistedHistory; view: ViewState;
  thumbnail?: Blob; thumbnailVersion: number;
}
export interface SavedBin {
  id: string;
  rootLayerIds: string[];
  layers: SavedLayer[];
  activeLayerId: string;
  history: PersistedHistory;
  view: ViewState;
  selection?: SavedPage['selection'];
  workArea: PageSpec;
}
export interface SavedProjectMeta {
  deletedSources?: {address: import('../../model').LayerAddress; layer: SavedLayer}[];
  activeBinId?: string | null;
  version: typeof PROJECT_VERSION; pageOrder: string[]; activePageId: string; fonts: ProjectFont[];
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
export interface LayerClipboard { version: typeof CLIPBOARD_VERSION; sourceDocument: DocumentKey; sourcePageIndex: number; sourcePpi: number; rootIds: string[]; layers: SavedLayer[] }
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
  if (!d.objectStoreNames.contains('bins')) d.createObjectStore('bins', {keyPath: 'id'});
  if (!d.objectStoreNames.contains('pages')) d.createObjectStore('pages', { keyPath: 'id' });
  if (!d.objectStoreNames.contains('references')) d.createObjectStore('references');
  const frames = d.objectStoreNames.contains('frames')
    ? tx.objectStore('frames')
    : d.createObjectStore('frames', { keyPath: 'key' });
  if (!frames.indexNames.contains('pageId')) frames.createIndex('pageId', 'pageId');
  if (!d.objectStoreNames.contains('clipboard')) d.createObjectStore('clipboard');
  if (!d.objectStoreNames.contains('thumbnails')) d.createObjectStore('thumbnails');
}

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(d, _oldVersion, _newVersion, transaction) {
      ensureStores(d, transaction);
    },
  });
  return dbPromise;
}

async function refreshProjectBytes(): Promise<void> {
  const d = await db();
  const meta = await readDocument(d,await d.get('kv','project-meta')) as SavedProjectMeta | undefined;
  projectBytes = await resourceBytes(d) + (meta?.fonts ?? []).reduce((n,font)=>n+font.dataUrl.length,0);
}

export async function saveProjectMeta(meta: SavedProjectMeta): Promise<void> {
  const prepared = await prepareDocument({id:'project-meta',...meta});
  const tx=(await db()).transaction(['kv'],'readwrite');
  await putDocument(tx,'kv',prepared); await tx.done;
  void refreshProjectBytes();
}
export async function loadProjectMeta(): Promise<SavedProjectMeta | undefined> {
  const d=await db();
  const value = await readDocument(d,await d.get('kv','project-meta'));
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
  const prepared = await prepareDocument(page);
  const d = await db();
  const tx = d.transaction(['kv','pages', 'thumbnails'], 'readwrite');
  await putDocument(tx,'pages',prepared);
  if (page.thumbnail) void tx.objectStore('thumbnails').put(page.thumbnail, page.id);
  await tx.done;
  void refreshProjectBytes();
}

/** A model snapshot and its history must commit together with its project metadata. */
export async function saveProjectSnapshot(meta: SavedProjectMeta, page: SavedPage): Promise<void> {
  const [prepared,preparedMeta] = await Promise.all([prepareDocument(page),prepareDocument({id:'project-meta',...meta})]);
  const d = await db();
  const tx = d.transaction(['kv', 'pages', 'thumbnails'], 'readwrite');
  await putDocument(tx,'kv',preparedMeta);
  await putDocument(tx,'pages',prepared);
  if (page.thumbnail) void tx.objectStore('thumbnails').put(page.thumbnail, page.id);
  await tx.done;
  void refreshProjectBytes();
}
export async function loadPage(id: string): Promise<SavedPage | undefined> {
  const d = await db();
  const value = await readDocument(d,await d.get('pages',id));
  return value === undefined ? undefined : migrateSavedPage(value);
}
export async function loadPageThumbnail(id: string): Promise<Blob | undefined> {
  return await (await db()).get('thumbnails', id) as Blob | undefined;
}

/** Replace all project data with the given meta and pages. */
export async function replaceProject(meta: SavedProjectMeta, pages: SavedPage[], bins: SavedBin[] = []): Promise<void> {
  const preparedPages = await Promise.all(pages.map(prepareDocument)), preparedBins = await Promise.all(bins.map(prepareDocument));
  const preparedMeta = await prepareDocument({id:'project-meta',...meta});
  const d = await db();
  referenceGeneration++;
  const tx = d.transaction(['kv', 'pages', 'bins', 'references', 'frames', 'clipboard', 'thumbnails'], 'readwrite');
  await Promise.all([
    tx.objectStore('pages').clear(),
    tx.objectStore('bins').clear(),
    tx.objectStore('references').clear(),
    tx.objectStore('frames').clear(),
    tx.objectStore('clipboard').clear(),
    tx.objectStore('thumbnails').clear(),
  ]);
  await tx.objectStore('kv').delete('project-meta');
  await clearResources(tx);
  await putDocument(tx,'kv',preparedMeta);
  for (const [index,page] of pages.entries()) {
    await putDocument(tx,'pages',preparedPages[index]);
    if (page.thumbnail) void tx.objectStore('thumbnails').put(page.thumbnail, page.id);
  }
  for (const bin of preparedBins) await putDocument(tx,'bins',bin);
  await tx.done;
  activePageId = meta.activePageId;
  frameBytes = 0;
  await refreshProjectBytes();
}

export async function deletePageData(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['kv','pages', 'references', 'frames', 'thumbnails'], 'readwrite');
  await deleteDocument(tx,'pages',id);
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


export async function loadBins(): Promise<SavedBin[]> {
  const d = await db();
  const items = await Promise.all((await d.getAll('bins')).map(item=>readDocument(d,item)));
  if (!items.every(isSavedBin)) throw new Error('ビンの保存形式が不正です');
  return items;
}
export async function saveBin(bin: SavedBin, meta?: SavedProjectMeta): Promise<void> {
  for (const layer of bin.layers) {
    if (layer.common.parameterLink?.source.document.kind === 'page') throw new Error('ビンからページは参照できません');
  }
  const prepared = await prepareDocument(bin), preparedMeta=meta && await prepareDocument({id:'project-meta',...meta});
  const tx = (await db()).transaction(['bins', 'kv'], 'readwrite');
  await putDocument(tx,'bins',prepared);
  if (preparedMeta) await putDocument(tx,'kv',preparedMeta);
  await tx.done;
}

export async function deleteBinData(id:string):Promise<void> {
  const tx=(await db()).transaction(['bins','kv'],'readwrite');
  await deleteDocument(tx,'bins',id);await tx.done;void refreshProjectBytes();
}
