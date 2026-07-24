import { openDB, type IDBPDatabase } from 'idb'
import type { PaintDocument } from '../document'
import type { LayerMeta } from '../types'

interface ProjectRecord {
  id: string
  width: number
  height: number
  activeLayerId: string | null
  metas: LayerMeta[]
  color: string
  brushSize: number
  colorHistory: string[]
  updatedAt: number
}

interface LayerBlobRecord {
  id: string // `${projectId}:${layerId}`
  projectId: string
  layerId: string
  blob: Blob
}

interface PaintDB {
  project: {
    key: string
    value: ProjectRecord
  }
  layerBlobs: {
    key: string
    value: LayerBlobRecord
  }
}

const DB_NAME = 'rin-paint'
const DB_VERSION = 1
const PROJECT_ID = 'current'

async function openPaintDb(): Promise<IDBPDatabase<PaintDB>> {
  return openDB<PaintDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('project')) {
        db.createObjectStore('project', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('layerBlobs')) {
        db.createObjectStore('layerBlobs', { keyPath: 'id' })
      }
    },
  })
}

export interface PersistUiState {
  color: string
  brushSize: number
  colorHistory: string[]
}

export async function saveProject(
  doc: PaintDocument,
  ui: PersistUiState,
): Promise<void> {
  const db = await openPaintDb()
  const metas = doc.layerMetas()
  const record: ProjectRecord = {
    id: PROJECT_ID,
    width: doc.width,
    height: doc.height,
    activeLayerId: doc.activeLayerId,
    metas,
    color: ui.color,
    brushSize: ui.brushSize,
    colorHistory: ui.colorHistory,
    updatedAt: Date.now(),
  }
  await db.put('project', record)

  // Save raster blobs
  const keepIds = new Set<string>()
  for (const layer of doc.layers) {
    if (layer.type !== 'raster') continue
    const blob = await new Promise<Blob | null>((resolve) =>
      layer.canvas.toBlob((b) => resolve(b), 'image/webp', 0.92),
    )
    if (!blob) continue
    const id = `${PROJECT_ID}:${layer.id}`
    keepIds.add(id)
    await db.put('layerBlobs', {
      id,
      projectId: PROJECT_ID,
      layerId: layer.id,
      blob,
    })
  }

  // Cleanup orphaned blobs
  const all = await db.getAll('layerBlobs')
  for (const row of all) {
    if (row.projectId === PROJECT_ID && !keepIds.has(row.id)) {
      await db.delete('layerBlobs', row.id)
    }
  }
}

export async function loadProject(
  doc: PaintDocument,
): Promise<PersistUiState | null> {
  const db = await openPaintDb()
  const record = await db.get('project', PROJECT_ID)
  if (!record) return null

  const pixels: Record<string, Blob> = {}
  const all = await db.getAll('layerBlobs')
  for (const row of all) {
    if (row.projectId === PROJECT_ID) {
      pixels[row.layerId] = row.blob
    }
  }

  const metaJson = JSON.stringify({
    metas: record.metas,
    activeLayerId: record.activeLayerId,
    width: record.width,
    height: record.height,
  })
  await doc.restoreStructure(metaJson, pixels)
  doc.history.clear()
  doc.requestComposite()

  return {
    color: record.color,
    brushSize: record.brushSize,
    colorHistory: record.colorHistory ?? [],
  }
}

export function createAutosave(
  doc: PaintDocument,
  getUi: () => PersistUiState,
  delayMs = 1500,
): { schedule: () => void; flush: () => Promise<void>; dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let saving: Promise<void> = Promise.resolve()

  const flush = async () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    saving = saving.then(() => saveProject(doc, getUi())).catch((e) => {
      console.error('autosave failed', e)
    })
    await saving
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, delayMs)
  }

  const unsub = doc.subscribe(schedule)

  return {
    schedule,
    flush,
    dispose: () => {
      unsub()
      if (timer) clearTimeout(timer)
    },
  }
}
