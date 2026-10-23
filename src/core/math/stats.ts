export function mean(a: ArrayLike<number>): number {
  let s = 0, n = 0
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) (s += a[i]), n++
  return n ? s / n : NaN
}

export function std(a: ArrayLike<number>): number {
  const m = mean(a)
  let s = 0, n = 0
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) (s += (a[i] - m) ** 2), n++
  return n ? Math.sqrt(s / n) : NaN
}

export function quantile(sorted: ArrayLike<number>, q: number): number {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function sortedFinite(a: ArrayLike<number>): Float64Array {
  const out: number[] = []
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) out.push(a[i])
  return Float64Array.from(out).sort()
}

export function median(a: ArrayLike<number>): number {
  return quantile(sortedFinite(a), 0.5)
}

export interface Histogram {
  edges: number[]
  counts: number[]
}

export function histogram(values: ArrayLike<number>, bins = 30, range?: [number, number]): Histogram {
  const s = sortedFinite(values)
  const lo = range?.[0] ?? (s.length ? s[0] : 0)
  let hi = range?.[1] ?? (s.length ? s[s.length - 1] : 1)
  if (hi <= lo) hi = lo + 1
  const w = (hi - lo) / bins
  const counts = new Array(bins).fill(0)
  for (const v of s) {
    if (v < lo || v > hi) continue
    counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++
  }
  return { edges: Array.from({ length: bins + 1 }, (_, i) => lo + i * w), counts }
}

export function summarize(a: ArrayLike<number>) {
  const s = sortedFinite(a)
  return {
    n: s.length,
    min: s[0] ?? NaN,
    p05: quantile(s, 0.05),
    p25: quantile(s, 0.25),
    median: quantile(s, 0.5),
    p75: quantile(s, 0.75),
    p95: quantile(s, 0.95),
    max: s[s.length - 1] ?? NaN,
    mean: mean(s),
    std: std(s),
  }
}
export type Summary = ReturnType<typeof summarize>
