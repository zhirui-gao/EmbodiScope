import type { RawColumn } from './parquet'
import { toNumber } from './parquet'

/** A numeric feature stored row-major: value(t, d) = data[t * dim + d]. */
export interface NumericColumn {
  key: string
  dim: number
  data: Float64Array
}

/**
 * Columnar, typed per-frame data for one episode.
 * Numeric features (scalars, vectors, fixed matrices flattened) live in `numeric`;
 * everything else (strings, image structs, depth PNG bytes …) is kept raw in `raw`.
 */
export class FrameTable {
  readonly numeric = new Map<string, NumericColumn>()
  readonly raw = new Map<string, RawColumn>()

  constructor(readonly length: number) {}

  static fromColumns(length: number, columns: Record<string, RawColumn>): FrameTable {
    const t = new FrameTable(length)
    for (const [key, col] of Object.entries(columns)) {
      const num = toNumericColumn(key, col, length)
      if (num) t.numeric.set(key, num)
      else t.raw.set(key, col)
    }
    return t
  }

  has(key: string) {
    return this.numeric.has(key)
  }

  /** Zero-copy view of rows [start, end) — used to split v3 files that hold many episodes. */
  slice(start: number, end: number): FrameTable {
    const t = new FrameTable(Math.max(0, end - start))
    for (const [k, c] of this.numeric) t.numeric.set(k, { key: k, dim: c.dim, data: c.data.subarray(start * c.dim, end * c.dim) })
    for (const [k, c] of this.raw) t.raw.set(k, Array.prototype.slice.call(c, start, end))
    return t
  }

  get(key: string): NumericColumn | undefined {
    return this.numeric.get(key)
  }

  /** Value of dim `d` of feature `key` at frame `t`. */
  value(key: string, t: number, d = 0): number {
    const c = this.numeric.get(key)
    if (!c) return NaN
    return c.data[t * c.dim + d]
  }

  /** Copy out a single dimension as a contiguous series. */
  series(key: string, d = 0): Float64Array {
    const c = this.numeric.get(key)
    const out = new Float64Array(this.length)
    if (!c) return out.fill(NaN)
    for (let t = 0; t < this.length; t++) out[t] = c.data[t * c.dim + d]
    return out
  }

  /** Slice [start,end) dims of a feature at frame t. */
  vector(key: string, t: number, start = 0, end?: number): number[] {
    const c = this.numeric.get(key)
    if (!c) return []
    const e = end ?? c.dim
    const out = new Array(e - start)
    for (let d = start; d < e; d++) out[d - start] = c.data[t * c.dim + d]
    return out
  }
}

function flattenValue(v: any, out: number[]): boolean {
  if (v == null) {
    out.push(NaN)
    return true
  }
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') {
    out.push(toNumber(v))
    return true
  }
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    // byte arrays are binary blobs (images / encoded depth), not numeric vectors
    if (v instanceof Uint8Array) return false
    const arr = v as ArrayLike<any>
    for (let i = 0; i < arr.length; i++) if (!flattenValue(arr[i], out)) return false
    return true
  }
  return false
}

function toNumericColumn(key: string, col: RawColumn, length: number): NumericColumn | null {
  // find first non-null sample to decide the shape
  let sample: any = undefined
  for (let i = 0; i < length; i++) {
    if (col[i] != null) {
      sample = col[i]
      break
    }
  }
  if (sample === undefined) return { key, dim: 1, data: new Float64Array(length).fill(NaN) }
  const probe: number[] = []
  if (!flattenValue(sample, probe)) return null
  const dim = probe.length
  if (dim === 0) return null
  const data = new Float64Array(length * dim)
  const buf: number[] = []
  for (let t = 0; t < length; t++) {
    const v = col[t]
    buf.length = 0
    if (v == null || !flattenValue(v, buf) || buf.length !== dim) {
      data.fill(NaN, t * dim, (t + 1) * dim)
      continue
    }
    for (let d = 0; d < dim; d++) data[t * dim + d] = buf[d]
  }
  return { key, dim, data }
}
