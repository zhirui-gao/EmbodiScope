import type { FrameTable } from '../data/frameTable'
import type { Mat3 } from '../math/rotation'
import { toMatrix } from '../math/rotation'
import type { Segment } from '../semantics/types'

export interface PoseTrack {
  segment: Segment
  length: number
  /** T*3 positions in metres (NaN when absent) */
  pos: Float64Array | null
  /** T*9 row-major rotation matrices */
  rot: Float64Array | null
}

const LENGTH_SCALE: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001 }

export function lengthScale(seg: Segment): number {
  return LENGTH_SCALE[seg.units?.length ?? 'm'] ?? 1
}

/** Decode a pose segment of an episode into positions (m) and rotation matrices. */
export function poseTrack(table: FrameTable, seg: Segment): PoseTrack | null {
  const col = table.get(seg.feature)
  if (!col || !seg.pose) return null
  const T = table.length
  const { pos: pIdx, rot: rSpec } = seg.pose
  const scale = lengthScale(seg)
  const angScale = seg.units?.angle === 'deg' ? Math.PI / 180 : 1
  let pos: Float64Array | null = null
  let rot: Float64Array | null = null
  if (pIdx) {
    pos = new Float64Array(T * 3)
    for (let t = 0; t < T; t++)
      for (let k = 0; k < 3; k++) pos[t * 3 + k] = col.data[t * col.dim + seg.start + pIdx[k]] * scale
  }
  if (rSpec) {
    rot = new Float64Array(T * 9)
    const v = new Array(rSpec.idx.length)
    const isEuler = rSpec.repr.startsWith('euler') || rSpec.repr === 'rotvec'
    for (let t = 0; t < T; t++) {
      for (let k = 0; k < rSpec.idx.length; k++) v[k] = col.data[t * col.dim + seg.start + rSpec.idx[k]] * (isEuler ? angScale : 1)
      if (v.some((x) => !Number.isFinite(x))) {
        rot.fill(NaN, t * 9, t * 9 + 9)
        continue
      }
      const m = toMatrix(rSpec.repr, v)
      for (let k = 0; k < 9; k++) rot[t * 9 + k] = m[k]
    }
  }
  return { segment: seg, length: T, pos, rot }
}

export function rotAt(track: PoseTrack, t: number): Mat3 | null {
  if (!track.rot) return null
  const o = t * 9
  const m = Array.from(track.rot.subarray(o, o + 9))
  return m.some((x) => !Number.isFinite(x)) ? null : m
}

export function posAt(track: PoseTrack, t: number): [number, number, number] | null {
  if (!track.pos) return null
  const p: [number, number, number] = [track.pos[t * 3], track.pos[t * 3 + 1], track.pos[t * 3 + 2]]
  return p.every(Number.isFinite) ? p : null
}

/** Gripper signal normalised to 0 = closed … 1 = open using the dataset-wide range when available. */
export function gripperSignal(table: FrameTable, seg: Segment): Float64Array | null {
  const col = table.get(seg.feature)
  if (!col) return null
  const T = table.length
  const out = new Float64Array(T)
  let lo = seg.gripper?.range?.[0]
  let hi = seg.gripper?.range?.[1]
  if (lo === undefined || hi === undefined || hi - lo < 1e-9) {
    lo = Infinity
    hi = -Infinity
    for (let t = 0; t < T; t++) {
      const v = col.data[t * col.dim + seg.start]
      if (Number.isFinite(v)) {
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
    }
  }
  const span = hi - lo || 1
  const flip = seg.gripper?.polarity === 'closed_high'
  for (let t = 0; t < T; t++) {
    const x = (col.data[t * col.dim + seg.start] - lo) / span
    out[t] = flip ? 1 - x : x
  }
  return out
}

/** Extract one segment as T×n matrix copy. */
export function segmentMatrix(table: FrameTable, seg: Segment): { n: number; data: Float64Array } | null {
  const col = table.get(seg.feature)
  if (!col) return null
  const n = seg.end - seg.start
  const T = table.length
  const data = new Float64Array(T * n)
  for (let t = 0; t < T; t++) for (let d = 0; d < n; d++) data[t * n + d] = col.data[t * col.dim + seg.start + d]
  return { n, data }
}
