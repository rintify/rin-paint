import type { Rect } from '../types'
import { createId } from '../types'

export type HistoryKind = 'raster-patch' | 'structure'

export interface RasterPatch {
  kind: 'raster-patch'
  layerId: string
  bounds: Rect
  beforeBlob: Blob
  afterBlob: Blob
}

export interface StructureSnapshot {
  kind: 'structure'
  /** JSON of layer metas + order; raster pixels stored separately by layer id */
  beforeMetaJson: string
  afterMetaJson: string
  beforePixels: Record<string, Blob>
  afterPixels: Record<string, Blob>
}

export type HistoryPatch = RasterPatch | StructureSnapshot

export interface HistoryNode {
  id: string
  parentId: string | null
  childIds: string[]
  preferredChildId: string | null
  patch: HistoryPatch
  byteSize: number
  label: string
  timestamp: number
}

const MAX_HISTORY_BYTES = 80 * 1024 * 1024 // 80MB soft limit

export type ApplyPatchFn = (patch: HistoryPatch, direction: 'undo' | 'redo') => Promise<void>

export class HistoryTree {
  private nodes = new Map<string, HistoryNode>()
  private rootId: string | null = null
  currentId: string | null = null
  private totalBytes = 0
  private applyPatch: ApplyPatchFn

  constructor(applyPatch: ApplyPatchFn) {
    this.applyPatch = applyPatch
  }

  get canUndo(): boolean {
    if (!this.currentId) return false
    const node = this.nodes.get(this.currentId)
    return !!node && node.parentId !== null
  }

  get canRedo(): boolean {
    if (!this.currentId) {
      // at virtual root before any action — redo first child of root if exists
      if (!this.rootId) return false
      const root = this.nodes.get(this.rootId)
      return !!root && root.childIds.length > 0
    }
    const node = this.nodes.get(this.currentId)
    if (!node) return false
    const next = node.preferredChildId ?? node.childIds[node.childIds.length - 1]
    return !!next
  }

  async push(patch: HistoryPatch, label: string): Promise<void> {
    const byteSize = estimatePatchBytes(patch)
    const node: HistoryNode = {
      id: createId('hist'),
      parentId: this.currentId,
      childIds: [],
      preferredChildId: null,
      patch,
      byteSize,
      label,
      timestamp: Date.now(),
    }

    if (this.currentId) {
      const parent = this.nodes.get(this.currentId)
      if (parent) {
        parent.childIds.push(node.id)
        parent.preferredChildId = node.id
      }
    } else if (!this.rootId) {
      this.rootId = node.id
    } else {
      // branching from before first action? treat as child of synthetic — attach to root's parent null chain
      // If current is null but root exists, we're undoing past root — shouldn't happen.
      // When current is null meaning "empty doc state before any history", and root exists after undo past root:
      const root = this.nodes.get(this.rootId)
      if (root && root.parentId === null && this.currentId === null) {
        // We're at the state before root; new action creates sibling of root under null parent
        // Keep tree by making new node also parentId null and set as new preferred from a virtual root.
        // Simpler: re-parent — make old root a sibling. For UX, attach as child by creating link from virtual.
        // Easiest approach: if undoing the root, currentId is null; push creates new root sibling and we set preferred via a list of roots.
        // Use a sentinel: store multiple roots in childIds of a virtual entry.
      }
    }

    // Handle null current (before any commit or after undoing root)
    if (this.currentId === null && this.rootId && this.rootId !== node.id) {
      // Create branch from empty state: keep old root, add new root sibling via synthetic
      if (!this.nodes.has('__virtual__')) {
        this.nodes.set('__virtual__', {
          id: '__virtual__',
          parentId: null,
          childIds: [this.rootId],
          preferredChildId: this.rootId,
          patch: {
            kind: 'structure',
            beforeMetaJson: '[]',
            afterMetaJson: '[]',
            beforePixels: {},
            afterPixels: {},
          },
          byteSize: 0,
          label: 'start',
          timestamp: 0,
        })
        const oldRoot = this.nodes.get(this.rootId)!
        oldRoot.parentId = '__virtual__'
        this.rootId = '__virtual__'
      }
      const virt = this.nodes.get('__virtual__')!
      virt.childIds.push(node.id)
      virt.preferredChildId = node.id
      node.parentId = '__virtual__'
    } else if (this.currentId === null && !this.rootId) {
      this.rootId = node.id
    }

    this.nodes.set(node.id, node)
    this.currentId = node.id
    this.totalBytes += byteSize
    await this.trimIfNeeded()
  }

  async undo(): Promise<boolean> {
    if (!this.canUndo || !this.currentId) return false
    const node = this.nodes.get(this.currentId)
    if (!node || node.id === '__virtual__') return false
    await this.applyPatch(node.patch, 'undo')
    this.currentId = node.parentId === '__virtual__' ? null : node.parentId
    if (this.currentId === '__virtual__') this.currentId = null
    return true
  }

  async redo(): Promise<boolean> {
    let fromId = this.currentId
    if (fromId === null) {
      fromId = this.rootId === '__virtual__' ? '__virtual__' : null
      if (fromId === null && this.rootId) {
        // single root, redo means apply root
        const root = this.nodes.get(this.rootId)
        if (!root) return false
        await this.applyPatch(root.patch, 'redo')
        this.currentId = root.id
        return true
      }
    }
    if (fromId === null) fromId = '__virtual__'
    const node = this.nodes.get(fromId)
    if (!node) return false
    const nextId = node.preferredChildId ?? node.childIds[node.childIds.length - 1]
    if (!nextId) return false
    const next = this.nodes.get(nextId)
    if (!next) return false
    await this.applyPatch(next.patch, 'redo')
    this.currentId = next.id
    return true
  }

  clear(): void {
    this.nodes.clear()
    this.rootId = null
    this.currentId = null
    this.totalBytes = 0
  }

  private async trimIfNeeded(): Promise<void> {
    if (this.totalBytes <= MAX_HISTORY_BYTES) return

    // Collect nodes on active path (keep)
    const keep = new Set<string>()
    let id = this.currentId
    while (id) {
      keep.add(id)
      const n = this.nodes.get(id)
      id = n?.parentId ?? null
    }
    if (this.rootId) keep.add(this.rootId)
    keep.add('__virtual__')

    // Also keep preferred redo path
    id = this.currentId
    while (id) {
      const n = this.nodes.get(id)
      if (!n) break
      const next = n.preferredChildId
      if (!next) break
      keep.add(next)
      id = next
    }

    // Delete oldest non-kept leaves first
    const candidates = [...this.nodes.values()]
      .filter((n) => !keep.has(n.id) && n.id !== '__virtual__')
      .sort((a, b) => a.timestamp - b.timestamp)

    for (const n of candidates) {
      if (this.totalBytes <= MAX_HISTORY_BYTES * 0.75) break
      this.removeNode(n.id)
    }
  }

  private removeNode(id: string): void {
    const node = this.nodes.get(id)
    if (!node) return
    // Detach from parent
    if (node.parentId) {
      const parent = this.nodes.get(node.parentId)
      if (parent) {
        parent.childIds = parent.childIds.filter((c) => c !== id)
        if (parent.preferredChildId === id) {
          parent.preferredChildId = parent.childIds[parent.childIds.length - 1] ?? null
        }
      }
    }
    // Recursively remove descendants not on keep — for simplicity remove entire subtree
    for (const childId of [...node.childIds]) {
      this.removeNode(childId)
    }
    this.totalBytes -= node.byteSize
    this.nodes.delete(id)
    if (this.rootId === id) this.rootId = null
  }
}

function estimatePatchBytes(patch: HistoryPatch): number {
  if (patch.kind === 'raster-patch') {
    return patch.beforeBlob.size + patch.afterBlob.size + 64
  }
  let size = patch.beforeMetaJson.length + patch.afterMetaJson.length
  for (const b of Object.values(patch.beforePixels)) size += b.size
  for (const b of Object.values(patch.afterPixels)) size += b.size
  return size
}

export async function canvasRegionToBlob(
  canvas: HTMLCanvasElement,
  bounds: Rect,
): Promise<Blob> {
  const { x, y, w, h } = bounds
  if (w <= 0 || h <= 0) {
    return new Blob([], { type: 'image/webp' })
  }
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  const tctx = tmp.getContext('2d')!
  tctx.clearRect(0, 0, w, h)
  tctx.drawImage(canvas, x, y, w, h, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((resolve) =>
    tmp.toBlob((b) => resolve(b), 'image/webp', 0.85),
  )
  return blob ?? new Blob([], { type: 'image/webp' })
}

export async function applyBlobToRegion(
  _canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  bounds: Rect,
  blob: Blob,
): Promise<void> {
  const { x, y, w, h } = bounds
  ctx.clearRect(x, y, w, h)
  if (blob.size === 0) return
  const bmp = await createImageBitmap(blob)
  ctx.drawImage(bmp, x, y)
  bmp.close()
}
