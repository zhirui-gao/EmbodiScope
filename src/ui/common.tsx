import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal panel" style={wide ? { width: 'min(1100px, 94vw)' } : undefined}>
        <div className="panel-head">
          <h3>{title}</h3>
          <button className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  )
}

export function Panel({ title, actions, children, bodyStyle, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; bodyStyle?: React.CSSProperties; className?: string }) {
  return (
    <div className={`panel ${className ?? ''}`}>
      {(title || actions) && (
        <div className="panel-head">
          <h3>{title}</h3>
          {actions}
        </div>
      )}
      <div className="panel-body" style={bodyStyle}>
        {children}
      </div>
    </div>
  )
}

export function Stat({ k, v, s }: { k: string; v: ReactNode; s?: ReactNode }) {
  return (
    <div className="panel stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  )
}

export function Badge({ kind, children, title }: { kind?: 'ok' | 'warn' | 'err' | 'info' | 'accent' | 'v3'; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${kind ?? ''}`} title={title}>
      {children}
    </span>
  )
}

export function ScoreBar({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="score-bar" title={`${value.toFixed(1)} / ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < Math.round(value) ? 'on' : ''} />
      ))}
    </span>
  )
}

export function fmtNum(x: number | undefined | null, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return '—'
  const a = Math.abs(x)
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return x.toExponential(digits)
  return x.toFixed(digits).replace(/\.?0+$/, '') || '0'
}

export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec)) return '—'
  if (sec < 60) return `${sec.toFixed(1)} s`
  if (sec < 3600) return `${(sec / 60).toFixed(1)} min`
  return `${(sec / 3600).toFixed(2)} h`
}

export function fmtBytes(n?: number): string {
  if (!n) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) (n /= 1024), i++
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`
}

/** Bar histogram rendered as SVG (no chart dependency). */
export function Histogram({
  values,
  bins = 24,
  height = 120,
  color = '#4da3ff',
  unit = '',
  series,
}: {
  values?: number[]
  bins?: number
  height?: number
  color?: string
  unit?: string
  /** multiple overlaid normalised series */
  series?: { name: string; values: number[]; color: string }[]
}) {
  const all = series ?? [{ name: '', values: values ?? [], color }]
  const flat = all.flatMap((s) => s.values).filter(Number.isFinite)
  const [hover, setHover] = useState<number | null>(null)
  const model = useMemo(() => {
    if (!flat.length) return null
    let lo = Math.min(...flat)
    let hi = Math.max(...flat)
    if (hi === lo) (hi = lo + 1), (lo = lo - (series ? 0 : 0))
    const w = (hi - lo) / bins
    const counts = all.map((s) => {
      const c = new Array(bins).fill(0)
      for (const v of s.values) if (Number.isFinite(v)) c[Math.min(bins - 1, Math.floor((v - lo) / w))]++
      const total = s.values.length || 1
      return series ? c.map((x) => x / total) : c
    })
    const max = Math.max(...counts.flat(), 1e-9)
    return { lo, hi, w, counts, max }
  }, [flat.length, bins, JSON.stringify(all.map((s) => s.values.length + s.name))])
  if (!model) return <div className="muted small">—</div>
  const W = 100
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }} onMouseLeave={() => setHover(null)}>
        {model.counts.map((c, si) =>
          c.map((v, i) => {
            const bw = W / bins
            const h = (v / model.max) * (height - 14)
            return (
              <rect
                key={`${si}-${i}`}
                x={i * bw + 0.15}
                y={height - 12 - h}
                width={bw - 0.3}
                height={h}
                fill={all[si].color}
                opacity={series ? 0.55 : hover === i ? 1 : 0.85}
                onMouseEnter={() => setHover(i)}
              />
            )
          }),
        )}
      </svg>
      <div className="row tiny faint" style={{ justifyContent: 'space-between', marginTop: -12 }}>
        <span>
          {fmtNum(model.lo)}
          {unit}
        </span>
        {hover != null && (
          <span className="muted">
            [{fmtNum(model.lo + hover * model.w)}, {fmtNum(model.lo + (hover + 1) * model.w)}){unit}: {model.counts.map((c) => (series ? `${(c[hover] * 100).toFixed(1)}%` : c[hover])).join(' / ')}
          </span>
        )}
        <span>
          {fmtNum(model.hi)}
          {unit}
        </span>
      </div>
      {series && (
        <div className="row wrap tiny" style={{ marginTop: 4 }}>
          {series.map((s) => (
            <span key={s.name} className="row" style={{ gap: 4 }}>
              <span style={{ width: 10, height: 10, background: s.color, borderRadius: 2, display: 'inline-block' }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export const PALETTE = ['#4da3ff', '#ff7b72', '#7ee787', '#d2a8ff', '#ffa657', '#79c0ff', '#f778ba', '#a5d6ff', '#e3b341', '#56d4dd', '#ff9bce', '#b3f088', '#c297ff', '#ffcf6b']

export function useSorted<T>(rows: T[], initial: { key: keyof T | string; dir: 1 | -1 }) {
  const [sort, setSort] = useState(initial)
  const sorted = useMemo(() => {
    const get = (r: any) => (typeof sort.key === 'string' && sort.key.includes('.') ? sort.key.split('.').reduce((o, k) => o?.[k], r) : r[sort.key])
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir
      return String(x).localeCompare(String(y)) * sort.dir
    })
  }, [rows, sort])
  const th = (key: string, label: ReactNode) => (
    <th className="sortable" onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : -1 }))}>
      {label}
      {sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
    </th>
  )
  return { sorted, th }
}
