import type { FrameTable } from '../data/frameTable'
import type { LeRobotDataset } from '../lerobot/types'
import { quantile, sortedFinite } from '../math/stats'
import type { DatasetSemantics } from '../semantics/types'
import { gripperSignal, poseTrack, segmentMatrix } from './poses'
import { addPowerSpectrum, energyQuantileHz, nextPow2 } from '../math/spectrum'

/** JSON-serialisable per-episode metrics (computed in workers during a dataset scan). */
export interface EpisodeMetrics {
  episode: number
  length: number
  duration: number
  dtMean: number
  dtStd: number
  /** largest timestamp step in units of the nominal frame period */
  maxGapFrames: number
  nonMonotonic: number
  /** frames whose dt deviates > 50 % from 1/fps */
  irregularSteps: number
  startTimestamp: number
  frameIndexOk: boolean
  nanCount: number
  nanFeatures: string[]
  constantDims: number
  /** seconds without motion at the start / end of the episode */
  idleHead: number
  idleTail: number
  idleRatio: number
  /** mean normalised motion per frame (unit-free) */
  motion: number
  /** per action segment: max |Δ| / p99 |Δ| — large values flag spikes / teleop glitches */
  maxJumpRatio: Record<string, number>
  /** per action segment: mean |Δ²| / mean |Δ| (higher = jerkier) */
  jerkiness: Record<string, number>
  /** per action segment: frequency (Hz) below which 90 % of the motion energy lies */
  bandwidth90: Record<string, number>
  /** EEF path length in metres per pose segment */
  pathLength: Record<string, number>
  quatNormErr: number
  quatSignFlips: number
  eulerWraps: number
  gripperEvents: number
  /** action vs paired state: best lag (frames) and relative errors */
  actionLag: Record<string, { lag: number; errAtLag: number; errAt0: number; identical: boolean }>
  /** subsampled EEF positions (m) for workspace plots, per pose segment id */
  workspace: Record<string, number[]>
  error?: string
}

const ACTION_STREAMS = new Set(['action', 'teleop'])

function finiteStd(arr: number[]) {
  let s = 0, s2 = 0, n = 0
  for (const v of arr) if (Number.isFinite(v)) (s += v), (s2 += v * v), n++
  return n ? Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) : 0
}

export function computeEpisodeMetrics(ds: Pick<LeRobotDataset, 'fps' | 'stats'>, sem: DatasetSemantics, table: FrameTable, episode: number): EpisodeMetrics {
  const T = table.length
  const fps = ds.fps || 30
  const m: EpisodeMetrics = {
    episode,
    length: T,
    duration: T / fps,
    dtMean: NaN,
    dtStd: NaN,
    maxGapFrames: 0,
    nonMonotonic: 0,
    irregularSteps: 0,
    startTimestamp: 0,
    frameIndexOk: true,
    nanCount: 0,
    nanFeatures: [],
    constantDims: 0,
    idleHead: 0,
    idleTail: 0,
    idleRatio: 0,
    motion: 0,
    maxJumpRatio: {},
    jerkiness: {},
    bandwidth90: {},
    pathLength: {},
    quatNormErr: 0,
    quatSignFlips: 0,
    eulerWraps: 0,
    gripperEvents: 0,
    actionLag: {},
    workspace: {},
  }
  if (T < 2) return m

  // ---- timing
  const ts = table.get('timestamp')
  if (ts) {
    const dts: number[] = []
    for (let t = 1; t < T; t++) {
      const dt = ts.data[t] - ts.data[t - 1]
      dts.push(dt)
      if (!(dt > 0)) m.nonMonotonic++
      if (Math.abs(dt * fps - 1) > 0.5) m.irregularSteps++
      m.maxGapFrames = Math.max(m.maxGapFrames, dt * fps)
    }
    m.startTimestamp = ts.data[0]
    m.duration = ts.data[T - 1] - ts.data[0] + 1 / fps
    const mu = dts.reduce((a, b) => a + b, 0) / dts.length
    m.dtMean = mu
    m.dtStd = Math.sqrt(dts.reduce((a, b) => a + (b - mu) ** 2, 0) / dts.length)
  }
  const fi = table.get('frame_index')
  if (fi) for (let t = 0; t < T; t++) if (fi.data[t] !== t) {
    m.frameIndexOk = false
    break
  }

  // ---- NaN / constant dims
  for (const [key, col] of table.numeric) {
    let nan = 0
    for (let i = 0; i < col.data.length; i++) if (!Number.isFinite(col.data[i])) nan++
    if (nan) {
      m.nanCount += nan
      m.nanFeatures.push(key)
    }
  }
  const signal = sem.segments.filter((s) => s.stream === 'observation' || ACTION_STREAMS.has(s.stream)).filter((s) => s.end > s.start && s.role !== 'label' && s.role !== 'index')
  for (const s of signal) {
    const col = table.get(s.feature)
    if (!col) continue
    for (let d = s.start; d < s.end; d++) {
      const v0 = col.data[d]
      let constant = true
      for (let t = 1; t < T && constant; t++) if (col.data[t * col.dim + d] !== v0) constant = false
      if (constant) m.constantDims++
    }
  }

  // ---- motion & idle (normalised by dataset std so units do not matter)
  const motionSegs = sem.segments.filter((s) => s.stream === 'observation' && ['joint_position', 'eef_pose', 'eef_position', 'hand_joints', 'position_2d'].includes(s.role))
  const speed = new Float64Array(T - 1)
  let used = 0
  for (const s of motionSegs) {
    const mat = segmentMatrix(table, s)
    if (!mat) continue
    const st = ds.stats?.[s.feature]
    for (let d = 0; d < mat.n; d++) {
      let sd = st?.std?.[s.start + d]
      if (!sd || !Number.isFinite(sd)) sd = finiteStd(Array.from({ length: T }, (_, t) => mat.data[t * mat.n + d]))
      if (!(sd > 1e-9)) continue
      used++
      for (let t = 1; t < T; t++) {
        const dv = (mat.data[t * mat.n + d] - mat.data[(t - 1) * mat.n + d]) / sd
        if (Number.isFinite(dv)) speed[t - 1] += dv * dv
      }
    }
  }
  if (used) {
    for (let t = 0; t < speed.length; t++) speed[t] = Math.sqrt(speed[t] / used)
    const sorted = sortedFinite(speed)
    const p90 = quantile(sorted, 0.9)
    const thr = Math.max(1e-4, 0.05 * p90)
    let head = 0
    while (head < speed.length && speed[head] < thr) head++
    let tail = 0
    while (tail < speed.length - head && speed[speed.length - 1 - tail] < thr) tail++
    let idle = 0
    for (const v of speed) if (v < thr) idle++
    m.idleHead = head / fps
    m.idleTail = tail / fps
    m.idleRatio = idle / speed.length
    m.motion = speed.reduce((a, b) => a + b, 0) / speed.length
  }

  // ---- action smoothness / spikes
  for (const s of sem.segments.filter((x) => ACTION_STREAMS.has(x.stream) && x.end > x.start && x.role !== 'label')) {
    const mat = segmentMatrix(table, s)
    if (!mat) continue
    // q and -q are the same rotation, and euler angles wrap at ±π: make both continuous so they do not count as spikes
    const rot = s.pose?.rot
    if (rot?.repr.startsWith('quat')) {
      for (let t = 1; t < T; t++) {
        let dot = 0
        for (const i of rot.idx) dot += mat.data[t * mat.n + i] * mat.data[(t - 1) * mat.n + i]
        if (dot < 0) for (const i of rot.idx) mat.data[t * mat.n + i] = -mat.data[t * mat.n + i]
      }
    } else if (rot && (rot.repr.startsWith('euler') || rot.repr === 'rotvec')) {
      for (let t = 1; t < T; t++)
        for (const i of rot.idx) {
          const d = mat.data[t * mat.n + i] - mat.data[(t - 1) * mat.n + i]
          if (Math.abs(d) > Math.PI) mat.data[t * mat.n + i] -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI
        }
    }
    const st = ds.stats?.[s.feature]
    const steps: number[] = []
    let d1 = 0, d2 = 0
    for (let t = 1; t < T; t++) {
      let n1 = 0, n2 = 0
      for (let d = 0; d < mat.n; d++) {
        const sd = st?.std?.[s.start + d] || 1
        const a = (mat.data[t * mat.n + d] - mat.data[(t - 1) * mat.n + d]) / sd
        n1 += a * a
        if (t >= 2) {
          const b = (mat.data[t * mat.n + d] - 2 * mat.data[(t - 1) * mat.n + d] + mat.data[(t - 2) * mat.n + d]) / sd
          n2 += b * b
        }
      }
      steps.push(Math.sqrt(n1))
      d1 += Math.sqrt(n1)
      d2 += Math.sqrt(n2)
    }
    const sorted = sortedFinite(steps)
    const p99 = quantile(sorted, 0.99)
    const max = sorted[sorted.length - 1] ?? 0
    m.maxJumpRatio[s.id] = p99 > 1e-9 ? max / p99 : 0
    m.jerkiness[s.id] = d1 > 1e-9 ? d2 / d1 : 0
    // motion bandwidth from the velocity spectrum (first differences), only for segments that actually move
    if (T >= 32 && s.actionType !== 'velocity' && s.role !== 'gripper' && d1 / (T - 1) > 1e-3) {
      const power = new Float64Array(nextPow2(T - 1) / 2)
      let used = 0
      for (let d = 0; d < mat.n; d++) {
        const sd = st?.std?.[s.start + d] || 1
        const vel = Float64Array.from({ length: T - 1 }, (_, t) => (mat.data[(t + 1) * mat.n + d] - mat.data[t * mat.n + d]) / sd)
        if (addPowerSpectrum(vel, power)) used++
      }
      if (used) m.bandwidth90[s.id] = energyQuantileHz(power, fps, 0.9)
    }
  }

  // ---- poses: path length, quaternion health, workspace samples
  for (const s of sem.segments.filter((x) => x.pose && (x.role === 'eef_pose' || x.role === 'eef_position') && x.stream === 'observation')) {
    const tr = poseTrack(table, s)
    if (!tr) continue
    if (tr.pos) {
      let L = 0
      for (let t = 1; t < T; t++) {
        const d = Math.hypot(tr.pos[t * 3] - tr.pos[t * 3 - 3], tr.pos[t * 3 + 1] - tr.pos[t * 3 - 2], tr.pos[t * 3 + 2] - tr.pos[t * 3 - 1])
        if (Number.isFinite(d)) L += d
      }
      m.pathLength[s.id] = L
      const stepN = Math.max(1, Math.floor(T / 40))
      const pts: number[] = []
      for (let t = 0; t < T; t += stepN) if (Number.isFinite(tr.pos[t * 3])) pts.push(+tr.pos[t * 3].toFixed(4), +tr.pos[t * 3 + 1].toFixed(4), +tr.pos[t * 3 + 2].toFixed(4))
      m.workspace[s.id] = pts
    }
    const rot = s.pose!.rot
    const col = table.get(s.feature)!
    if (rot?.repr.startsWith('quat')) {
      let prev: number[] | null = null
      for (let t = 0; t < T; t++) {
        const q = rot.idx.map((i) => col.data[t * col.dim + s.start + i])
        const n = Math.hypot(...q)
        if (Number.isFinite(n)) m.quatNormErr = Math.max(m.quatNormErr, Math.abs(n - 1))
        if (prev && q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3] < -0.5) m.quatSignFlips++
        prev = q
      }
    } else if (rot?.repr.startsWith('euler')) {
      for (let t = 1; t < T; t++)
        for (const i of rot.idx) {
          const d = col.data[t * col.dim + s.start + i] - col.data[(t - 1) * col.dim + s.start + i]
          if (Math.abs(d) > Math.PI) m.eulerWraps++
        }
    }
  }

  // ---- gripper open / close events
  for (const s of sem.segments.filter((x) => x.role === 'gripper' && x.stream === 'observation')) {
    const g = gripperSignal(table, s)
    if (!g) continue
    let state = g[0] > 0.5
    for (let t = 1; t < T; t++) {
      const now = state ? g[t] > 0.35 : g[t] > 0.65
      if (now !== state) {
        m.gripperEvents++
        state = now
      }
    }
  }

  // ---- action ↔ state temporal alignment
  for (const a of sem.segments.filter((x) => ACTION_STREAMS.has(x.stream) && x.pairedWith && x.actionType === 'absolute')) {
    const o = sem.segments.find((x) => x.id === a.pairedWith)
    if (!o) continue
    const A = segmentMatrix(table, a)
    const O = segmentMatrix(table, o)
    if (!A || !O || A.n !== O.n) continue
    const n = A.n
    const range = (M: Float64Array, d: number) => {
      let lo = Infinity, hi = -Infinity
      for (let t = 0; t < T; t++) {
        const v = M[t * n + d]
        if (Number.isFinite(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v))
      }
      return [lo, Math.max(hi - lo, 1e-6)]
    }
    const span = new Array(n).fill(0).map((_, d) => range(O.data, d)[1])
    // commands and measurements in different units (gripper openness 0..1 vs width in m): compare min-max normalised signals
    for (let d = 0; d < n; d++) {
      const [alo, aspan] = range(A.data, d)
      const [olo, ospan] = range(O.data, d)
      if (aspan / ospan > 3 || ospan / aspan > 3) {
        for (let t = 0; t < T; t++) {
          A.data[t * n + d] = (A.data[t * n + d] - alo) / aspan
          O.data[t * n + d] = (O.data[t * n + d] - olo) / ospan
        }
        span[d] = 1
      }
    }
    const maxLag = Math.min(15, Math.floor(T / 4))
    let best = 0, bestErr = Infinity, err0 = Infinity
    let exact = true
    for (let k = 0; k <= maxLag; k++) {
      let e = 0, c = 0
      for (let t = 0; t + k < T; t++)
        for (let d = 0; d < n; d++) {
          const diff = Math.abs(A.data[t * n + d] - O.data[(t + k) * n + d])
          if (!Number.isFinite(diff)) continue
          if (k === 0 && diff > 1e-7) exact = false
          e += diff / span[d]
          c++
        }
      e = c ? e / c : Infinity
      if (k === 0) err0 = e
      if (e < bestErr - 1e-9) (bestErr = e), (best = k)
    }
    m.actionLag[a.id] = { lag: best, errAtLag: bestErr, errAt0: err0, identical: exact }
  }
  return m
}
