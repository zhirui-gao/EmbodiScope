import { useState } from 'react'
import type { DatasetEntry } from '@app/store'
import { useL } from '@app/i18n'
import { fmtNum } from '../common'

/** Per-dimension min/max/mean±std of one segment on a shared axis (normalisation design aid). */
export function DimStats({ entry }: { entry: DatasetEntry }) {
  const L = useL()
  const { ds, sem } = entry
  const segs = sem.segments.filter((s) => s.end > s.start && ds.stats?.[s.feature]?.min && s.role !== 'index')
  const [id, setId] = useState(segs.find((s) => s.stream === 'action')?.id ?? segs[0]?.id)
  const seg = segs.find((s) => s.id === id)
  if (!segs.length) return <div className="muted small">{L('No statistics (stats.json / episodes_stats) in this dataset.', '该数据集没有统计信息（stats.json / episodes_stats）。')}</div>
  const st = seg ? ds.stats![seg.feature] : undefined
  const rows = seg && st
    ? Array.from({ length: seg.end - seg.start }, (_, k) => {
        const d = seg.start + k
        return { name: seg.names[k] ?? String(d), min: st.min![d], max: st.max![d], mean: st.mean?.[d] ?? NaN, std: st.std?.[d] ?? NaN }
      })
    : []
  const lo = Math.min(...rows.map((r) => r.min))
  const hi = Math.max(...rows.map((r) => r.max))
  const span = hi - lo || 1
  const x = (v: number) => `${((v - lo) / span) * 100}%`
  const widest = Math.max(...rows.map((r) => r.max - r.min))
  return (
    <div className="col">
      <div className="row">
        <select value={id} onChange={(e) => setId(e.target.value)}>
          {segs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.stream} · {s.id}
            </option>
          ))}
        </select>
        <span className="muted tiny">
          {L('shared axis', '共享坐标轴')} [{fmtNum(lo, 3)}, {fmtNum(hi, 3)}] · {L('band = mean ± std', '色带 = 均值 ± 标准差')} · <span style={{ color: 'var(--err)' }}>{L('red = constant dim', '红色 = 常量维度')}</span>
        </span>
      </div>
      <div style={{ maxHeight: 420, overflow: 'auto' }}>
        {rows.map((r, i) => {
          const constant = r.max - r.min < 1e-9 || r.std < 1e-9
          const tiny = !constant && widest > 0 && (r.max - r.min) / widest < 0.01
          return (
            <div key={i} className="row tiny" style={{ height: 18 }}>
              <span className="mono ellipsis" style={{ width: 170 }} title={r.name}>
                {r.name}
              </span>
              <div style={{ position: 'relative', flex: 1, height: 10, background: '#121923', borderRadius: 3 }}>
                <div style={{ position: 'absolute', left: x(r.min), width: `max(2px, calc(${x(r.max)} - ${x(r.min)}))`, top: 3, height: 4, background: constant ? 'var(--err)' : '#3b6ea8', borderRadius: 2 }} />
                {Number.isFinite(r.std) && (
                  <div style={{ position: 'absolute', left: x(r.mean - r.std), width: `calc(${x(r.mean + r.std)} - ${x(r.mean - r.std)})`, top: 1, height: 8, background: '#4da3ff66', borderRadius: 2 }} />
                )}
                {Number.isFinite(r.mean) && <div style={{ position: 'absolute', left: x(r.mean), top: 0, width: 2, height: 10, background: '#fff' }} />}
              </div>
              <span className="mono faint" style={{ width: 210, textAlign: 'right' }}>
                {fmtNum(r.min, 3)} … {fmtNum(r.max, 3)} · σ {fmtNum(r.std, 3)}
              </span>
              {(constant || tiny) && <span style={{ color: constant ? 'var(--err)' : 'var(--warn)', width: 60 }}>{constant ? L('const', '常量') : L('tiny', '极小')}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
