import { Muxer, ArrayBufferTarget } from 'webm-muxer'
import { openDB, type IDBPDatabase } from 'idb'
import type { PaintDocument } from '../document'

interface TimelapseChunk {
  id?: number
  sessionId: string
  timestamp: number
  data: ArrayBuffer
  type: string
  duration: number | null
  isKey: boolean
}

interface TimelapseDB {
  chunks: {
    key: number
    value: TimelapseChunk
    indexes: { 'by-session': string }
  }
  sessions: {
    key: string
    value: {
      id: string
      width: number
      height: number
      frameCount: number
      createdAt: number
    }
  }
}

const DB_NAME = 'rin-paint-timelapse'
const DB_VERSION = 1

async function openTimelapseDb(): Promise<IDBPDatabase<TimelapseDB>> {
  return openDB<TimelapseDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('chunks')) {
        const store = db.createObjectStore('chunks', { keyPath: 'id', autoIncrement: true })
        store.createIndex('by-session', 'sessionId')
      }
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' })
      }
    },
  })
}

export class TimelapseRecorder {
  private doc: PaintDocument
  private sessionId: string
  private encoder: VideoEncoder | null = null
  private frameIndex = 0
  private width: number
  private height: number
  private recording = false
  private pending = Promise.resolve()
  private supported = typeof VideoEncoder !== 'undefined'
  private muxCodec: 'V_VP9' | 'V_VP8' = 'V_VP9'

  constructor(doc: PaintDocument, width?: number, height?: number) {
    this.doc = doc
    this.width = width ?? doc.width
    this.height = height ?? doc.height
    this.sessionId = `tl_${Date.now().toString(36)}`
  }

  get isSupported(): boolean {
    return this.supported
  }

  get isRecording(): boolean {
    return this.recording
  }

  get frames(): number {
    return this.frameIndex
  }

  async start(): Promise<void> {
    if (!this.supported) {
      console.warn('WebCodecs VideoEncoder not available')
      return
    }
    this.recording = true
    this.frameIndex = 0
    this.sessionId = `tl_${Date.now().toString(36)}`

    const db = await openTimelapseDb()
    await db.put('sessions', {
      id: this.sessionId,
      width: this.width,
      height: this.height,
      frameCount: 0,
      createdAt: Date.now(),
    })

    const picked = await pickCodec(this.width, this.height)
    if (!picked) {
      this.supported = false
      this.recording = false
      return
    }
    this.muxCodec = picked.mux

    this.encoder = new VideoEncoder({
      output: (chunk) => {
        this.pending = this.pending.then(() => this.persistChunk(chunk))
      },
      error: (e) => console.error('Timelapse encoder error', e),
    })

    this.encoder.configure({
      codec: picked.codec,
      width: this.width,
      height: this.height,
      bitrate: 2_000_000,
      framerate: 10,
      latencyMode: 'quality',
    })

    // Initial blank/white frame
    await this.captureFrame()
  }

  async captureFrame(): Promise<void> {
    if (!this.recording || !this.encoder || this.encoder.state !== 'configured') return

    const canvas = this.doc.compositor.renderOpaque(this.doc.layers)
    // Scale if needed
    let source: HTMLCanvasElement = canvas
    if (canvas.width !== this.width || canvas.height !== this.height) {
      const scaled = document.createElement('canvas')
      scaled.width = this.width
      scaled.height = this.height
      const sctx = scaled.getContext('2d')!
      sctx.drawImage(canvas, 0, 0, this.width, this.height)
      source = scaled
    }

    const frame = new VideoFrame(source, {
      timestamp: (this.frameIndex * 1_000_000) / 10, // 10 fps
      duration: 100_000,
    })
    const keyFrame = this.frameIndex % 30 === 0
    this.encoder.encode(frame, { keyFrame })
    frame.close()
    this.frameIndex++

    const db = await openTimelapseDb()
    const session = await db.get('sessions', this.sessionId)
    if (session) {
      session.frameCount = this.frameIndex
      await db.put('sessions', session)
    }
  }

  /** Called on committed drawing actions — not on undo. */
  onActionCommitted(_label: string): void {
    void this.captureFrame()
  }

  async stopAndExport(): Promise<Blob | null> {
    if (!this.encoder) return null
    await this.encoder.flush()
    this.encoder.close()
    this.encoder = null
    this.recording = false
    await this.pending

    return this.muxSession(this.sessionId)
  }

  async exportCurrent(): Promise<Blob | null> {
    if (this.encoder) {
      await this.encoder.flush()
      await this.pending
    }
    return this.muxSession(this.sessionId)
  }

  private async persistChunk(chunk: EncodedVideoChunk): Promise<void> {
    const data = new ArrayBuffer(chunk.byteLength)
    chunk.copyTo(data)
    const db = await openTimelapseDb()
    await db.add('chunks', {
      sessionId: this.sessionId,
      timestamp: chunk.timestamp,
      data,
      type: chunk.type,
      duration: chunk.duration,
      isKey: chunk.type === 'key',
    })
  }

  private async muxSession(sessionId: string): Promise<Blob | null> {
    const db = await openTimelapseDb()
    const session = await db.get('sessions', sessionId)
    if (!session) return null

    const chunks = await db.getAllFromIndex('chunks', 'by-session', sessionId)
    if (chunks.length === 0) return null
    chunks.sort((a, b) => a.timestamp - b.timestamp)

    const target = new ArrayBufferTarget()
    const muxer = new Muxer({
      target,
      video: {
        codec: this.muxCodec,
        width: session.width,
        height: session.height,
      },
      firstTimestampBehavior: 'offset',
    })

    for (const c of chunks) {
      const chunk = new EncodedVideoChunk({
        type: c.type as EncodedVideoChunkType,
        timestamp: c.timestamp,
        duration: c.duration ?? undefined,
        data: c.data,
      })
      muxer.addVideoChunk(chunk)
    }
    muxer.finalize()
    return new Blob([target.buffer], { type: 'video/webm' })
  }
}

async function pickCodec(
  width: number,
  height: number,
): Promise<{ codec: string; mux: 'V_VP9' | 'V_VP8' } | null> {
  const candidates: Array<{ codec: string; mux: 'V_VP9' | 'V_VP8' }> = [
    { codec: 'vp09.00.10.08', mux: 'V_VP9' },
    { codec: 'vp8', mux: 'V_VP8' },
  ]
  for (const c of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: c.codec,
        width,
        height,
        bitrate: 2_000_000,
      })
      if (support.supported) return c
    } catch {
      /* continue */
    }
  }
  return null
}
