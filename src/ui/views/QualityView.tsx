import { useMemo, useState } from 'react'
import type { DatasetEntry } from '@app/store'
import { useStore } from '@app/store'
import { useL } from '@app/i18n'
import { download, selectEpisode } from '@app/actions'
import { cancelScan, scanDataset } from '@app/scan'
import type { Issue, Severity } from '@core/analysis/qa'
import type { EpisodeMetrics } from '@core/analysis/episodeMetrics'
import { Badge, Histogram, PALETTE, Panel, fmtNum, useSorted } from '../common'
import { term } from '@app/terms'

export function IssueList({ issues, limit, onEpisode, onFlag }: { issues: Issue[]; limit?: number; onEpisode?: (e: number) => void; onFlag?: (eps: number[]) => void }) {
  const lang = useStore((s) => s.lang)
  const L = useL()
  const [filter, setFilter] = useState<Severity | 'all'>('all')
  const shown = issues.filter((i) => filter === 'all' || i.severity === filter).slice(0, limit ?? Infinity)
  const counts = { error: 0, warning: 0, info: 0 }
  for (const i of issues) counts[i.severity]++
  return (
    <div className="col">
      {!limit && (
        <div className="row">
          {(['all', 'error', 'warning', 'info'] as const).map((s) => (
            <button key={s} className={`small ${filter === s ? 'primary' : ''}`} onClick={() => setFilter(s)}>
              {s === 'all' ? L('All', '全部') : term(lang, s)} {s !== 'all' ? `(${counts[s]})` : `(${issues.length})`}
            </button>
          ))}
        </div>
      )}
      {!shown.length && <div className="muted small">✓ {L('No issues.', '没有发现问题。')}</div>}
      {shown.map((i, k) => (
        <div key={k} className={`issue ${i.severity}`}>
          <div className="row">
            <Badge kind={i.severity === 'error' ? 'err' : i.severity === 'warning' ? 'warn' : 'info'}>{term(lang, i.severity)}</Badge>
            <Badge>{term(lang, i.category)}</Badge>
            <b className="grow">{i.title[lang]}</b>
            {onFlag && i.episodes?.length ? (
              <button className="small ghost" onClick={() => onFlag(i.episodes!)} title={L('Flag all affected episodes for review', '将所有相关 episode 标为待复查')}>
                ? {L('flag for review', '标为待复查')} ({i.episodes.length})
              </button>
            ) : null}
          </div>
          <div className="small" style={{ marginTop: 3 }}>
            {i.detail[lang]}
          </div>
          {i.hint && <div className="small muted">💡 {i.hint[lang]}</div>}
          {i.episodes && onEpisode && (
            <div style={{ marginTop: 3 }}>
              {i.episodes.slice(0, 40).map((e) => (
                <span key={e} className="chip" onClick={() => onEpisode(e)}>
                  #{e}
                </span>
              ))}
              {i.episodes.length > 40 && <span className="faint tiny"> +{i.episodes.length - 40}</span>}
            </div>
          )}
        </div>
      ))}
      {limit && issues.length > limit && <div className="muted small">… {issues.length - limit} more</div>}
    </div>
  )
}

/** Orthographic scatter of EEF positions (two projections) colored per pose segment. */
export function WorkspacePlot({ points, axes = [0, 1], height = 240 }: { points: { label: string; color: string; pts: number[] }[]; axes?: [number, number]; height?: number }) {
  const all = points.flatMap((p) => p.pts)
  if (!all.length) return <div className="muted small">—</div>
  const xs: number[] = [], ys: number[] = []
  for (const p of points) for (let i = 0; i + 2 < p.pts.length; i += 3) xs.push(p.pts[i + axes[0]]), ys.push(p.pts[i + axes[1]])
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)]
  const span = Math.max(x1 - x0, y1 - y0, 1e-3) * 1.1
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  const W = 300
  const sx = (v: number) => ((v - cx) / span + 0.5) * W
  const sy = (v: number) => (0.5 - (v - cy) / span) * W
  const name = 'xyz'
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${W}`} style={{ width: '100%', height, background: '#0b1017', borderRadius: 6 }}>
        {points.map((p) => {
          const out = []
          for (let i = 0; i + 2 < p.pts.length; i += 3) out.push(<circle key={i} cx={sx(p.pts[i + axes[0]])} cy={sy(p.pts[i + axes[1]])} r={1.4} fill={p.color} opacity={0.55} />)
          return <g key={p.label}>{out}</g>
        })}
        <text x={6} y={W - 6} fill="#8b9ab0" fontSize={10}>
          {name[axes[0]]} → · {name[axes[1]]} ↑ · {fmtNum(span, 2)} m
        </text>
      </svg>
      <div className="row wrap tiny">
        {points.map((p) => (
          <span key={p.label} className="row" style={{ gap: 4 }}>
            <span style={{ width: 8, height: 8, background: p.color, borderRadius: 4, display: 'inline-block' }} />
            {p.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function workspacePoints(metrics: EpisodeMetrics[]) {
  const ids = [...new Set(metrics.flatMap((m) => Object.keys(m.workspace)))]
  return ids.map((id, i) => ({ label: id, color: PALETTE[i % PALETTE.length], pts: metrics.flatMap((m) => m.workspace[id] ?? []) }))
}

export function QualityView({ entry }: { entry: DatasetEntry }) {
  const L = useL()
  const lang = useStore((s) => s.lang)
  const scan = entry.scan
  const metrics = scan?.metrics ?? []
  const rows = useMemo(
    () =>
      metrics.map((m) => ({
        ...m,
        idle: m.idleHead + m.idleTail,
        jump: Math.max(0, ...Object.values(m.maxJumpRatio)),
        path: Object.values(m.pathLength).reduce((a, b) => a + b, 0),
        lag: Object.values(m.actionLag)[0]?.lag ?? NaN,
        bw: ((v: number[]) => (v.length ? Math.max(...v) : NaN))(Object.values(m.bandwidth90 ?? {}).filter(Number.isFinite)),
      })),
    [metrics],
  )
  const { sorted, th } = useSorted(rows, { key: 'episode', dir: 1 })
  const ws = useMemo(() => workspacePoints(metrics), [metrics])

  return (
    <div className="view">
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="grow">
          <h2>{L('Data quality', '数据质量检测')}</h2>
          <div className="muted small">
            {L(
              'Metadata checks run instantly; the scan reads every episode in parallel Web Workers (only the needed columns) and probes video headers.',
              '元数据检查即时完成；全量扫描会在多个 Web Worker 中并行读取每个 episode（只读取所需列），并探测视频文件头。',
            )}
          </div>
        </div>
        {scan?.status === 'running' ? (
          <button onClick={() => cancelScan(entry.id)}>{L('Cancel', '取消')}</button>
        ) : (
          <button className="primary" onClick={() => scanDataset(entry.id)}>
            🩺 {scan ? L('Re-scan', '重新扫描') : L('Run full scan', '开始全量扫描')}
          </button>
        )}
        {scan?.status === 'done' && <button onClick={() => download(`${entry.ds.name}_metrics.json`, JSON.stringify(metrics, null, 1))}>⬇ metrics.json</button>}
      </div>
      {scan && (
        <div className="panel panel-body" style={{ marginBottom: 12 }}>
          <div className="row small">
            <span>
              {term(lang, scan.status)} · {scan.done}/{scan.total} episodes
            </span>
            {scan.ms && <span className="muted">· {(scan.ms / 1000).toFixed(1)} s</span>}
            {scan.cachedAt && <Badge kind="info">{L('restored from cache', '来自缓存')} · {new Date(scan.cachedAt).toLocaleString()}</Badge>}
            {scan.error && <Badge kind="err">{scan.error}</Badge>}
            {metrics.some((m) => m.error) && <Badge kind="warn">{metrics.filter((m) => m.error).length} {L('failed', '个失败')}</Badge>}
          </div>
          <div className="progress" style={{ marginTop: 6 }}>
            <div style={{ width: `${(scan.done / Math.max(1, scan.total)) * 100}%` }} />
          </div>
        </div>
      )}
      <Panel title={`${L('Issues', '问题列表')} (${entry.issues.length})`}>
        <IssueList
          issues={entry.issues}
          onEpisode={selectEpisode}
          onFlag={(eps) => {
            const st = useStore.getState()
            const cur = st.flags[entry.id] ?? {}
            st.setFlags(entry.id, eps.filter((e) => !cur[e]), { flag: 'review' })
            st.notify(L(`${eps.length} episodes flagged for review`, `已将 ${eps.length} 个 episode 标为待复查`))
          }}
        />
      </Panel>
      {metrics.length > 0 && (
        <>
          <div className="grid g4" style={{ marginTop: 12 }}>
            <Panel title={L('Idle at start + end (s)', '首尾静止时长 (s)')}>
              <Histogram values={rows.map((r) => r.idle)} unit="s" color="#d29922" height={90} />
            </Panel>
            <Panel title={L('Idle frame ratio', '静止帧比例')}>
              <Histogram values={rows.map((r) => r.idleRatio * 100)} unit="%" color="#ff7b72" height={90} />
            </Panel>
            <Panel title={L('Max action jump ratio', '最大动作跳变比')}>
              <Histogram values={rows.map((r) => r.jump)} color="#d2a8ff" height={90} />
            </Panel>
            <Panel title={L('EEF path length (m)', '末端路径长度 (m)')}>
              <Histogram values={rows.map((r) => r.path).filter((x) => x > 0)} unit="m" color="#7ee787" height={90} />
            </Panel>
          </div>
          {ws.length > 0 && (
            <Panel title={L('EEF workspace coverage (sampled positions, all episodes)', '末端工作空间覆盖（所有 episode 采样点）')} className="" bodyStyle={{ padding: 10 }}>
              <div className="grid g3">
                <WorkspacePlot points={ws} axes={[0, 1]} />
                <WorkspacePlot points={ws} axes={[0, 2]} />
                <WorkspacePlot points={ws} axes={[1, 2]} />
              </div>
            </Panel>
          )}
          <div className="section-title">
            <h3>{L('Per-episode metrics', '逐 episode 指标')}</h3>
            <span className="muted tiny">{L('click a row to open the episode', '点击行打开对应 episode')}</span>
          </div>
          <div className="panel" style={{ maxHeight: 480, overflow: 'auto' }}>
            <table className="t">
              <thead>
                <tr>
                  {th('episode', '#')}
                  {th('length', L('frames', '帧数'))}
                  {th('duration', L('dur (s)', '时长(s)'))}
                  {th('maxGapFrames', L('max gap', '最大间隔'))}
                  {th('idleHead', L('idle head', '开头静止'))}
                  {th('idleTail', L('idle tail', '结尾静止'))}
                  {th('idleRatio', L('idle %', '静止%'))}
                  {th('motion', L('motion', '运动量'))}
                  {th('jump', L('max jump', '最大跳变'))}
                  {th('path', L('path (m)', '路径(m)'))}
                  {th('gripperEvents', L('grip events', '夹爪开合'))}
                  {th('lag', L('act lag', '动作延迟'))}
                  {th('bw', L('bw90 (Hz)', '带宽90(Hz)'))}
                  {th('nanCount', 'NaN')}
                  {th('constantDims', L('const dims', '常量维'))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <tr key={m.episode} className="clickable" onClick={() => selectEpisode(m.episode)}>
                    <td className="mono">{m.episode}</td>
                    <td>{m.length}</td>
                    <td>{fmtNum(m.duration, 1)}</td>
                    <td style={{ color: m.maxGapFrames > 1.5 ? 'var(--warn)' : undefined }}>{fmtNum(m.maxGapFrames, 2)}</td>
                    <td>{fmtNum(m.idleHead, 1)}</td>
                    <td>{fmtNum(m.idleTail, 1)}</td>
                    <td style={{ color: m.idleRatio > 0.5 ? 'var(--warn)' : undefined }}>{fmtNum(m.idleRatio * 100, 0)}</td>
                    <td>{fmtNum(m.motion, 3)}</td>
                    <td style={{ color: m.jump > 6 ? 'var(--warn)' : undefined }}>{fmtNum(m.jump, 1)}</td>
                    <td>{fmtNum(m.path, 2)}</td>
                    <td>{m.gripperEvents}</td>
                    <td>{Number.isFinite(m.lag) ? m.lag : '—'}</td>
                    <td>{fmtNum(m.bw, 2)}</td>
                    <td style={{ color: m.nanCount ? 'var(--err)' : undefined }}>{m.nanCount}</td>
                    <td>{m.constantDims}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
