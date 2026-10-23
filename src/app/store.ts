import { create } from 'zustand'
import type { FileSource } from '@core/io/source'
import type { LeRobotDataset } from '@core/lerobot/types'
import type { DatasetSemantics } from '@core/semantics/types'
import type { DatasetCard, SubtaskSegment } from '@core/analysis/summary'
import type { Issue } from '@core/analysis/qa'
import type { EpisodeMetrics } from '@core/analysis/episodeMetrics'
import type { VideoProbe } from '@core/video/mp4'
import type { LlmConfig } from '@core/ai/llm'
import type { FormatAnalysis } from '@core/ai/prompts'
import { PRESETS } from '@core/ai/llm'

export type Tab = 'overview' | 'episode' | 'schema' | 'quality' | 'compare' | 'ai'

export interface ScanState {
  status: 'running' | 'done' | 'error' | 'cancelled'
  done: number
  total: number
  metrics: EpisodeMetrics[]
  videos?: Record<string, VideoProbe>
  ms?: number
  error?: string
}

export interface DatasetEntry {
  id: string
  ds: LeRobotDataset
  sem: DatasetSemantics
  card: DatasetCard
  issues: Issue[]
  scan?: ScanState
  formatAnalysis?: FormatAnalysis
  /** bump to re-render after in-place semantic edits */
  version: number
}

export interface SourceEntry {
  id: string
  source: FileSource
  label: string
  datasets: { root: string; name: string; status: 'pending' | 'loading' | 'ready' | 'error'; error?: string; id?: string }[]
}

/** Per-episode annotations produced by heuristics / LLMs / the user. Keyed by dataset id then episode index. */
export interface EpisodeAnnotation {
  segments: SubtaskSegment[]
  caption?: string
  scene?: string
  success?: boolean | null
  model?: string
  updatedAt: number
}

export interface Settings {
  llm: LlmConfig & { presetId: string; persistKey: boolean }
  upAxis: 'z' | 'y'
  showOverlay: boolean
  showGhostFrames: boolean
  chartsPerRow: number
}

const SETTINGS_KEY = 'embodiscope.settings.v1'

function loadSettings(): Settings {
  const p = PRESETS[1]
  const defaults: Settings = {
    llm: { presetId: p.id, kind: p.kind, baseUrl: p.baseUrl, apiKey: '', model: p.model, visionModel: p.visionModel, temperature: 0.2, maxTokens: 4096, jsonMode: true, persistKey: false },
    upAxis: 'z',
    showOverlay: true,
    showGhostFrames: true,
    chartsPerRow: 2,
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const s = JSON.parse(raw)
      return { ...defaults, ...s, llm: { ...defaults.llm, ...s.llm, apiKey: s.llm?.apiKey ?? sessionStorage.getItem(SETTINGS_KEY + '.key') ?? '' } }
    }
  } catch {
    // corrupted settings fall back to defaults
  }
  return defaults
}

export function saveSettings(s: Settings) {
  const copy = { ...s, llm: { ...s.llm, apiKey: s.llm.persistKey ? s.llm.apiKey : undefined } }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(copy))
  if (!s.llm.persistKey) sessionStorage.setItem(SETTINGS_KEY + '.key', s.llm.apiKey)
}

export interface AppState {
  lang: 'zh' | 'en'
  tab: Tab
  sources: SourceEntry[]
  datasets: Record<string, DatasetEntry>
  currentId: string | null
  episodeIndex: number | null
  compareIds: string[]
  annotations: Record<string, Record<number, EpisodeAnnotation>>
  settings: Settings
  busy: string | null
  toast: { text: string; kind: 'info' | 'error' } | null
  set: (p: Partial<AppState>) => void
  updateDataset: (id: string, fn: (d: DatasetEntry) => Partial<DatasetEntry>) => void
  setAnnotation: (datasetId: string, ep: number, a: EpisodeAnnotation | null) => void
  updateSettings: (fn: (s: Settings) => Settings) => void
  notify: (text: string, kind?: 'info' | 'error') => void
}

const initialLang = (() => {
  const saved = localStorage.getItem('embodiscope.lang')
  if (saved === 'zh' || saved === 'en') return saved
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
})()

export const useStore = create<AppState>((set, get) => ({
  lang: initialLang,
  tab: 'overview',
  sources: [],
  datasets: {},
  currentId: null,
  episodeIndex: null,
  compareIds: [],
  annotations: {},
  settings: loadSettings(),
  busy: null,
  toast: null,
  set: (p) => {
    if (p.lang) localStorage.setItem('embodiscope.lang', p.lang)
    set(p)
  },
  updateDataset: (id, fn) => {
    const d = get().datasets[id]
    if (!d) return
    set({ datasets: { ...get().datasets, [id]: { ...d, ...fn(d) } } })
  },
  setAnnotation: (datasetId, ep, a) => {
    const all = { ...get().annotations }
    const forDs = { ...(all[datasetId] ?? {}) }
    if (a) forDs[ep] = a
    else delete forDs[ep]
    all[datasetId] = forDs
    set({ annotations: all })
    persistAnnotations(datasetId, forDs)
  },
  updateSettings: (fn) => {
    const s = fn(get().settings)
    saveSettings(s)
    set({ settings: s })
  },
  notify: (text, kind = 'info') => {
    set({ toast: { text, kind } })
    setTimeout(() => {
      if (get().toast?.text === text) set({ toast: null })
    }, kind === 'error' ? 8000 : 3500)
  },
}))

// ---- annotation persistence (localStorage, keyed by dataset id)
const ANN_KEY = (id: string) => `embodiscope.ann.${id}`
function persistAnnotations(id: string, data: Record<number, EpisodeAnnotation>) {
  try {
    localStorage.setItem(ANN_KEY(id), JSON.stringify(data))
  } catch {
    // quota exceeded: annotations stay in memory, user can export
  }
}
export function restoreAnnotations(id: string) {
  try {
    const raw = localStorage.getItem(ANN_KEY(id))
    if (raw) useStore.setState((s) => ({ annotations: { ...s.annotations, [id]: JSON.parse(raw) } }))
  } catch {
    // ignore corrupted entries
  }
}

export const currentEntry = (s: AppState) => (s.currentId ? s.datasets[s.currentId] : undefined)
