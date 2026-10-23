import type { FrameTable } from '../data/frameTable'
import type { DatasetSemantics } from '../semantics/types'
import { gripperSignal, poseTrack } from './poses'
import type { SubtaskSegment } from './summary'

interface Event {
  t: number
  side: string
  kind: 'close' | 'open'
}

function smooth(x: Float64Array, w: number): Float64Array {
  const out = new Float64Array(x.length)
  let s = 0
  const q: number[] = []
  for (let i = 0; i < x.length; i++) {
    const v = Number.isFinite(x[i]) ? x[i] : 0
    q.push(v)
    s += v
    if (q.length > w) s -= q.shift()!
    out[i] = s / q.length
  }
  return out
}

/**
 * Training-free baseline segmentation: gripper close / open events split the episode into
 * approach → grasp/transport → release phases; without grippers, EEF speed minima are used.
 */
export function heuristicSegments(table: FrameTable, sem: DatasetSemantics, fps: number): SubtaskSegment[] {
  const T = table.length
  if (T < 4) return []
  const events: Event[] = []
  const grippers = sem.segments.filter((s) => s.role === 'gripper' && s.stream === 'observation')
  for (const g of grippers) {
    const sig = gripperSignal(table, g)
    if (!sig) continue
    const sm = smooth(sig, Math.max(1, Math.round(fps * 0.1)))
    let open = sm[0] > 0.5
    for (let t = 1; t < T; t++) {
      const now = open ? sm[t] > 0.35 : sm[t] > 0.65
      if (now !== open) {
        events.push({ t, side: g.side ?? '', kind: now ? 'open' : 'close' })
        open = now
      }
    }
  }
  const minLen = Math.max(2, Math.round(fps * 0.5))
  events.sort((a, b) => a.t - b.t)
  const merged: Event[] = []
  for (const e of events) {
    const last = merged[merged.length - 1]
    if (last && e.t - last.t < minLen && last.side === e.side) {
      merged.pop()
      continue
    }
    merged.push(e)
  }

  if (!merged.length) {
    // speed minima of the main EEF / joints
    const pose = sem.segments.find((s) => s.stream === 'observation' && (s.role === 'eef_pose' || s.role === 'eef_position'))
    const tr = pose ? poseTrack(table, pose) : null
    if (!tr?.pos) return [{ start: 0, end: T, text: 'whole episode', source: 'heuristic' }]
    const sp = new Float64Array(T)
    for (let t = 1; t < T; t++) sp[t] = Math.hypot(tr.pos[t * 3] - tr.pos[t * 3 - 3], tr.pos[t * 3 + 1] - tr.pos[t * 3 - 2], tr.pos[t * 3 + 2] - tr.pos[t * 3 - 1])
    const s = smooth(sp, Math.max(3, Math.round(fps * 0.4)))
    const sorted = Array.from(s).sort((a, b) => a - b)
    const thr = sorted[Math.floor(sorted.length * 0.5)] * 0.3
    const cuts: number[] = []
    for (let t = minLen; t < T - minLen; t++) if (s[t] < thr && s[t] <= s[t - 1] && s[t] <= s[t + 1] && (!cuts.length || t - cuts[cuts.length - 1] > fps)) cuts.push(t)
    const bounds = [0, ...cuts, T]
    return bounds.slice(0, -1).map((b, i) => ({ start: b, end: bounds[i + 1], text: `motion segment ${i + 1}`, source: 'heuristic' }))
  }

  const label = (side: string) => (side ? `${side} ` : '')
  const out: SubtaskSegment[] = []
  let cur = 0
  let prev: Event | null = null
  const holding = new Set<string>()
  for (const e of merged) {
    const text = !prev
      ? 'approach / reach'
      : prev.kind === 'close'
        ? `${label(prev.side)}grasp & move${holding.size > 1 ? ' (bimanual hold)' : ''}`
        : `${label(prev.side)}release & reposition`
    if (e.t > cur) out.push({ start: cur, end: e.t, text, skill: !prev ? 'reach' : prev.kind === 'close' ? 'pick/move' : 'place', source: 'heuristic' })
    if (e.kind === 'close') holding.add(e.side)
    else holding.delete(e.side)
    cur = e.t
    prev = e
  }
  out.push({
    start: cur,
    end: T,
    text: prev?.kind === 'open' ? 'retreat' : `${label(prev?.side ?? '')}grasp & move`,
    skill: prev?.kind === 'open' ? 'retreat' : 'pick/move',
    source: 'heuristic',
  })
  return out.filter((s) => s.end - s.start >= 1)
}
