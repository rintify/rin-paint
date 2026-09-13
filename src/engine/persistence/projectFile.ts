import type { SavedBinItem, SavedPage, SavedProjectMeta, SavedSharedLayerEntity } from './db';
import { migrateProjectMeta, migrateSavedPage } from './migrate';
import { PROJECT_MAGIC, PROJECT_VERSION } from './version';

export interface ProjectFile {
  app: 'rin-paint';
  version: typeof PROJECT_VERSION;
  meta: SavedProjectMeta;
  pages: SavedPage[];
  bins: SavedBinItem[];
  entities: SavedSharedLayerEntity[];
}

export type ProjectFileInput = Omit<ProjectFile, 'bins' | 'entities'> & Partial<Pick<ProjectFile, 'bins' | 'entities'>>;

const MAGIC = new TextEncoder().encode(PROJECT_MAGIC);

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

async function encodeValue(value: unknown, blobs: Blob[]): Promise<unknown> {
  if (value instanceof Blob) return { $blob: blobs.push(value) - 1, type: value.type };
  if (Array.isArray(value)) return Promise.all(value.map((item) => encodeValue(item, blobs)));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      if (key === 'dataUrl' && typeof item === 'string' && item.startsWith('data:')) {
        const blob = await (await fetch(item)).blob();
        output[key] = { $dataUrlBlob: blobs.push(blob) - 1, type: blob.type };
      } else {
        output[key] = await encodeValue(item, blobs);
      }
    }
    return output;
  }
  return value;
}

async function decodeValue(value: unknown, blobs: Blob[]): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((item) => decodeValue(item, blobs)));
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (typeof object.$blob === 'number') {
      return blobs[object.$blob].slice(0, blobs[object.$blob].size, typeof object.type === 'string' ? object.type : '');
    }
    if (typeof object.$dataUrlBlob === 'number') {
      return blobToDataURL(
        blobs[object.$dataUrlBlob].slice(
          0,
          blobs[object.$dataUrlBlob].size,
          typeof object.type === 'string' ? object.type : '',
        ),
      );
    }
    const entries = await Promise.all(
      Object.entries(object).map(async ([key, item]) => [key, await decodeValue(item, blobs)] as const),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

/** magic + manifest length + JSON manifest + raw blobs. Base64 is never used. */
export async function packProjectFile(project: ProjectFileInput): Promise<Blob> {
  const blobs: Blob[] = [];
  const data = await encodeValue({ ...project, bins: project.bins ?? [], entities: project.entities ?? [] }, blobs);
  const manifest = new TextEncoder().encode(JSON.stringify({ data, sizes: blobs.map((blob) => blob.size) }));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, manifest.length, true);
  return new Blob([MAGIC, length, manifest, ...blobs], { type: 'application/x-rinpaint' });
}

export async function unpackProjectFile(file: Blob): Promise<ProjectFile> {
  const header = new Uint8Array(await file.slice(0, MAGIC.length + 4).arrayBuffer());
  const matches = (magic: Uint8Array) => magic.every((byte, index) => header[index] === byte);
  if (header.length < MAGIC.length + 4 || !matches(MAGIC)) {
    throw new Error('このプロジェクト形式には対応していません。ヒエラルキー形式のプロジェクトを選択してください。');
  }
  const manifestLength = new DataView(header.buffer, header.byteOffset + MAGIC.length, 4).getUint32(0, true);
  const start = MAGIC.length + 4;
  const manifest = JSON.parse(
    new TextDecoder().decode(await file.slice(start, start + manifestLength).arrayBuffer()),
  ) as { data: unknown; sizes: number[] };
  let offset = start + manifestLength;
  const blobs = manifest.sizes.map((size) => {
    const blob = file.slice(offset, offset + size);
    offset += size;
    return blob;
  });
  const raw = (await decodeValue(manifest.data, blobs)) as Record<string, unknown>;
  if (raw?.app !== 'rin-paint' || raw.version !== PROJECT_VERSION || !Array.isArray(raw.pages) || !raw.pages.length
    || !Array.isArray(raw.bins) || !Array.isArray(raw.entities)) {
    throw new Error('このプロジェクト形式には対応していません。旧形式からの移行はできません。');
  }
  return {
    app: 'rin-paint',
    version: PROJECT_VERSION,
    meta: migrateProjectMeta(raw.meta),
    pages: raw.pages.map(migrateSavedPage),
    bins: raw.bins as SavedBinItem[],
    entities: raw.entities as SavedSharedLayerEntity[],
  };
}
