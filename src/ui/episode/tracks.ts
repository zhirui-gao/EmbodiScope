import type { FrameTable } from '@core/data/frameTable'
import type { DatasetEntry, EpisodeAnnotation } from '@app/store'
import { metadataSubtasks } from '@core/analysis/summary'
import type { SubtaskSegment } from '@core/analysis/summary'
import { gripperSignal } from '@core/analysis/poses'
import { heuristicSegments } from '@core/analysis/segmentation'

export interface TrackSeg {
  start: number
  end: number
  text: string
  color: string
  detail?: string
}

export interface TimelineTrack {
  id: string
  label: string
  kind: 'subtask' | 'label' | 'gripper' | 'llm' | 'heuristic'
  segs: TrackSeg[]
}

const COLORS = ['#3b6ea8', '#8a4fa3', '#2f8f6f', '#a8663b', '#a83b5d', '#5d7a2f', '#3b8fa8', '#7a5d2f', '#5b5fc7', '#a84f8a', '#4f8aa8', '#8f8f2f']
export function colorFor(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

function runs(values: ArrayLike<number>, map: (v: number) => string | null): TrackSeg[] {
  const out: TrackSeg[] = []
  let start = 0
  for (let t = 1; t <= values.length; t++) {
    if (t === values.length || values[t] !== values[start]) {
      const text = map(values[start])
      if (text !== null) out.push({ start, end: t, text, color: colorFor(text) })
      start = t
    }
  }
  return out
}

const fromSubtasks = (segs: SubtaskSegment[]): TrackSeg[] =>
  segs.map((s) => ({ start: s.start, end: s.end, text: s.text || s.skill || '', color: colorFor(s.skill ?? s.text), detail: [s.skill, s.caption].filter(Boolean).join(' · ') }))

export function buildTracks(entry: DatasetEntry, epIndex: number, table: FrameTable, ann?: EpisodeAnnotation): TimelineTrack[] {
  const { ds, sem } = entry
  const out: TimelineTrack[] = []
  const meta = metadataSubtasks(ds, epIndex)
  if (meta.length) out.push({ id: 'meta', label: 'subtasks (metadata)', kind: 'subtask', segs: fromSubtasks(meta) })

  // per-frame categorical label columns decoded through vocabularies
  for (const s of sem.segments.filter((x) => x.role === 'label')) {
    const col = table.get(s.feature)
    if (!col) continue
    const vocab = ds.extras.vocabularies.find((v) => v.name === s.entity) ?? ds.extras.vocabularies.find((v) => s.feature.startsWith(v.name))
    for (let d = 0; d < col.dim; d++) {
      const series = table.series(s.feature, d)
      const segs = runs(series, (v) => {
        const txt = vocab?.labels.get(v) ?? String(v)
        return txt === 'null' || txt === 'None' ? null : txt
      })
      if (!segs.length) continue
      // skip constant "scene" style tracks with a single long value only when they add no info
      const base = s.names[d] && !/\[\d+\]$/.test(s.names[d]) ? s.names[d] : col.dim > 1 ? `${s.feature}[${d}]` : s.feature
      const suffix = /_state$/.test(s.feature) ? ' (state)' : /_action$/.test(s.feature) ? ' (action)' : ''
      out.push({ id: `${s.feature}#${d}`, label: base + (base.includes(s.feature) ? '' : suffix), kind: 'label', segs })
    }
  }

  for (const g of sem.segments.filter((x) => x.role === 'gripper' && x.stream === 'observation')) {
    const sig = gripperSignal(table, g)
    if (!sig) continue
    const binary = Array.from(sig, (v) => (Number.isFinite(v) ? (v > 0.5 ? 1 : 0) : -1))
    out.push({ id: `grip:${g.id}`, label: `${g.side ?? ''} gripper`.trim(), kind: 'gripper', segs: runs(binary, (v) => (v < 0 ? null : v ? 'open' : 'closed')).map((s) => ({ ...s, color: s.text === 'open' ? '#2f6f4a' : '#7a2f2f' })) })
  }

  if (ann?.segments.length) out.push({ id: 'ann', label: ann.model ? `AI · ${ann.model}` : 'annotation', kind: 'llm', segs: fromSubtasks(ann.segments) })
  const heur = heuristicSegments(table, sem, ds.fps || 30)
  if (heur.length > 1) out.push({ id: 'heur', label: 'auto (gripper/motion)', kind: 'heuristic', segs: fromSubtasks(heur) })
  return out
}
