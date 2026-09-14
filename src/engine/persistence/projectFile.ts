import {
  assetBlobs,
  collectAssetIds,
  decodeAsset,
  registerAsset,
  remapRasterAssetIds,
} from '../raster/RasterAssetRepository';
import type { SavedPage, SavedProjectMeta } from './db';
import { migrateProjectMeta, migrateSavedPage } from './migrate';
import { PROJECT_MAGIC, PROJECT_VERSION } from './version';

export interface ProjectFile {
  app: 'rin-paint';
  version: typeof PROJECT_VERSION;
  meta: SavedProjectMeta;
  pages: SavedPage[];
  rasterAssets?: Record<string, Blob>;
}

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
  if (value instanceof Blob)
    return { $blob: blobs.push(value) - 1, type: value.type };
  if (Array.isArray(value))
    return Promise.all(value.map((item) => encodeValue(item, blobs)));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      if (
        key === 'dataUrl' &&
        typeof item === 'string' &&
        item.startsWith('data:')
      ) {
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
  if (Array.isArray(value))
    return Promise.all(value.map((item) => decodeValue(item, blobs)));
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (typeof object.$blob === 'number') {
      if (!Number.isInteger(object.$blob) || !blobs[object.$blob])
        throw new Error('Blob参照が不正です');
      return blobs[object.$blob].slice(
        0,
        blobs[object.$blob].size,
        typeof object.type === 'string' ? object.type : '',
      );
    }
    if (typeof object.$dataUrlBlob === 'number') {
      if (!Number.isInteger(object.$dataUrlBlob) || !blobs[object.$dataUrlBlob])
        throw new Error('Blob参照が不正です');
      return blobToDataURL(
        blobs[object.$dataUrlBlob].slice(
          0,
          blobs[object.$dataUrlBlob].size,
          typeof object.type === 'string' ? object.type : '',
        ),
      );
    }
    const entries = await Promise.all(
      Object.entries(object).map(
        async ([key, item]) => [key, await decodeValue(item, blobs)] as const,
      ),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

/** magic + manifest length + JSON manifest + raw blobs. Base64 is never used. */
export async function packProjectFile(project: ProjectFile): Promise<Blob> {
  const blobs: Blob[] = [];
  const data = await encodeValue(
    { ...project, rasterAssets: await assetBlobs(project.pages) },
    blobs,
  );
  const manifest = new TextEncoder().encode(
    JSON.stringify({ data, sizes: blobs.map((blob) => blob.size) }),
  );
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, manifest.length, true);
  return new Blob([MAGIC, length, manifest, ...blobs], {
    type: 'application/x-rinpaint',
  });
}

export async function unpackProjectFile(file: Blob): Promise<ProjectFile> {
  const header = new Uint8Array(
    await file.slice(0, MAGIC.length + 4).arrayBuffer(),
  );
  const matches = (magic: Uint8Array) =>
    magic.every((byte, index) => header[index] === byte);
  if (header.length < MAGIC.length + 4 || !matches(MAGIC)) {
    throw new Error('rin-paint v11 のプロジェクトファイルではありません');
  }
  const manifestLength = new DataView(
    header.buffer,
    header.byteOffset + MAGIC.length,
    4,
  ).getUint32(0, true);
  const start = MAGIC.length + 4;
  if (manifestLength > file.size - start)
    throw new Error('プロジェクトが途中で切れています');
  const manifest = JSON.parse(
    new TextDecoder().decode(
      await file.slice(start, start + manifestLength).arrayBuffer(),
    ),
  ) as { data: unknown; sizes: number[] };
  if (
    !Array.isArray(manifest.sizes) ||
    manifest.sizes.some((size) => !Number.isSafeInteger(size) || size < 0) ||
    manifest.sizes.reduce((n, size) => n + size, 0) !==
      file.size - start - manifestLength
  )
    throw new Error('プロジェクトの長さが不正です');
  let offset = start + manifestLength;
  const blobs = manifest.sizes.map((size) => {
    const blob = file.slice(offset, offset + size);
    offset += size;
    return blob;
  });
  const raw = (await decodeValue(manifest.data, blobs)) as Record<
    string,
    unknown
  >;
  if (
    raw?.app !== 'rin-paint' ||
    raw.version !== PROJECT_VERSION ||
    !Array.isArray(raw.pages) ||
    !raw.pages.length
  ) {
    throw new Error('rin-paint v11 のプロジェクトファイルではありません');
  }
  const sourceAssets = raw.rasterAssets as Record<string, Blob> | undefined;
  const rasterAssets: Record<string, Blob> = {},
    ids = new Map<string, string>();
  // Import into new IDs, so a malformed file cannot reuse a cached tile from the open document.
  for (const id of collectAssetIds(raw.pages)) {
    const blob = sourceAssets?.[id];
    if (!(blob instanceof Blob))
      throw new Error('プロジェクトの画像タイルが不足しています');
    const nextId = crypto.randomUUID();
    ids.set(id, nextId);
    rasterAssets[nextId] = blob;
    registerAsset(nextId, blob);
    await decodeAsset(nextId);
  }
  remapRasterAssetIds(raw.pages, ids);
  return {
    rasterAssets,
    app: 'rin-paint',
    version: PROJECT_VERSION,
    meta: migrateProjectMeta(raw.meta),
    pages: raw.pages.map(migrateSavedPage),
  };
}
