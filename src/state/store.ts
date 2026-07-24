import { create } from 'zustand'
import type { BlendMode, ToolId } from '../engine/types'
import type { LayerMeta } from '../engine/types'
import type { SelectionState } from '../engine/tools'

export interface EyedropperState {
  active: boolean
  x: number
  y: number
  color: string
  /** screen coords for loupe */
  screenX: number
  screenY: number
}

interface AppState {
  tool: ToolId
  color: string
  brushSize: number
  colorHistory: string[]
  layers: LayerMeta[]
  activeLayerId: string | null
  canUndo: boolean
  canRedo: boolean
  eyedropper: EyedropperState | null
  selection: SelectionState | null
  timelapseFrames: number
  timelapseRecording: boolean
  ready: boolean

  setTool: (tool: ToolId) => void
  setColor: (color: string, addHistory?: boolean) => void
  setBrushSize: (size: number) => void
  pushColorHistory: (color: string) => void
  setLayers: (layers: LayerMeta[], activeLayerId: string | null) => void
  setHistoryFlags: (canUndo: boolean, canRedo: boolean) => void
  setEyedropper: (state: EyedropperState | null) => void
  setSelection: (sel: SelectionState | null) => void
  setTimelapse: (recording: boolean, frames: number) => void
  setReady: (ready: boolean) => void
  hydrateUi: (ui: { color: string; brushSize: number; colorHistory: string[] }) => void
}

const MAX_COLOR_HISTORY = 12

export const useAppStore = create<AppState>((set, get) => ({
  tool: 'brush',
  color: '#1a1a1a',
  brushSize: 12,
  colorHistory: ['#1a1a1a', '#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#ffffff'],
  layers: [],
  activeLayerId: null,
  canUndo: false,
  canRedo: false,
  eyedropper: null,
  selection: null,
  timelapseFrames: 0,
  timelapseRecording: false,
  ready: false,

  setTool: (tool) => set({ tool }),
  setColor: (color, addHistory = false) => {
    set({ color })
    if (addHistory) get().pushColorHistory(color)
  },
  setBrushSize: (brushSize) => set({ brushSize: Math.max(1, Math.min(200, brushSize)) }),
  pushColorHistory: (color) => {
    const hist = get().colorHistory.filter((c) => c.toLowerCase() !== color.toLowerCase())
    hist.unshift(color)
    set({ colorHistory: hist.slice(0, MAX_COLOR_HISTORY) })
  },
  setLayers: (layers, activeLayerId) => set({ layers, activeLayerId }),
  setHistoryFlags: (canUndo, canRedo) => set({ canUndo, canRedo }),
  setEyedropper: (eyedropper) => set({ eyedropper }),
  setSelection: (selection) => set({ selection }),
  setTimelapse: (timelapseRecording, timelapseFrames) => set({ timelapseRecording, timelapseFrames }),
  setReady: (ready) => set({ ready }),
  hydrateUi: (ui) =>
    set({
      color: ui.color,
      brushSize: ui.brushSize,
      colorHistory: ui.colorHistory.length ? ui.colorHistory : get().colorHistory,
    }),
}))

export type { BlendMode, ToolId, LayerMeta }
