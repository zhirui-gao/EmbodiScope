import { useMemo, useRef, useState } from 'react'
import { currentEntry, issueEpisodes, useStore } from '@app/store'
import type { EpisodeFilter } from '@app/curation'
import { exportCuration, filterEpisodes } from '@app/curation'

export const FLAG_ICON = { keep: '✓', exclude: '✗', review: '?' } as const
import { useL, useLabel, EMBODIMENT_LABEL } from '@app/i18n'
import { selectEpisode } from '@app/actions'
import { Badge, fmtDuration } from './common'

const ROW = 30

export function Sidebar() {
  const L = useL()
  const label = useLabel()
  const sources = useStore((s) => s.sources)
  const datasets = useStore((s) => s.datasets)
  const currentId = useStore((s) => s.currentId)
  const set = useStore((s) => s.set)
  const entry = useStore(currentEntry)
  const episodeIndex = useStore((s) => s.episodeIndex)
  const annotations = useStore((s) => (s.currentId ? s.annotations[s.currentId] : undefined))
  const flags = useStore((s) => (s.currentId ? s.flags[s.currentId] : undefined))
  const [filter, setFilter] = useState('')
  const [flagFilter, setFlagFilter] = useState<EpisodeFilter>('all')
  const [exportOpen, setExportOpen] = useState(false)
  const [libFilter, setLibFilter] = useState('')
  const [scrollTop, setScrollTop] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const episodes = useMemo(() => {
    if (!entry) return []
    const f = filter.trim().toLowerCase()
    return filterEpisodes(entry, flags, flagFilter, issueEpisodes(entry)).filter((e) => !f || String(e.index).includes(f) || e.tasks.some((t) => t.toLowerCase().includes(f)))
  }, [entry, filter, flags, flagFilter])
  const flagCounts = useMemo(() => {
    const c = { keep: 0, exclude: 0, review: 0 }
    for (const f of Object.values(flags ?? {})) c[f.flag]++
    return c
  }, [flags])

  const totalDatasets = sources.reduce((a, s) => a + s.datasets.length, 0)
  const height = listRef.current?.clientHeight ?? 400
  const first = Math.max(0, Math.floor(scrollTop / ROW) - 5)
  const last = Math.min(episodes.length, first + Math.ceil(height / ROW) + 10)
  const fps = entry?.ds.fps || 30

  return (
    <div className="sidebar">
      <div style={{ padding: '10px 12px 6px' }} className="row">
        <h4 className="grow">
          {L('Datasets', '数据集')} ({totalDatasets})
        </h4>
        {totalDatasets > 6 && <input className="small" style={{ width: 110 }} placeholder={L('filter', '筛选')} value={libFilter} onChange={(e) => setLibFilter(e.target.value)} />}
      </div>
      <div style={{ maxHeight: '42%', overflow: 'auto', borderBottom: '1px solid var(--line)' }}>
        {sources.map((src) => (
          <div key={src.id}>
            <div className="tiny faint ellipsis" style={{ padding: '2px 12px' }} title={src.label}>
              {src.source.kind === 'hf' ? '🤗' : '📁'} {src.label}
            </div>
            {src.datasets
              .filter((d) => !libFilter || d.root.toLowerCase().includes(libFilter.toLowerCase()))
              .map((d) => {
                const e = d.id ? datasets[d.id] : undefined
                return (
                  <div
                    key={d.root}
                    className={`list-item ${d.id && d.id === currentId ? 'active' : ''}`}
                    onClick={() => d.id && set({ currentId: d.id, episodeIndex: null, tab: useStore.getState().tab === 'compare' || useStore.getState().tab === 'ai' ? useStore.getState().tab : 'overview' })}
                    title={d.root || src.label}
                  >
                    <div className="row">
                      <span className="grow ellipsis" style={{ fontWeight: 500 }}>
                        {d.name}
                      </span>
                      {d.status === 'loading' && <div className="spinner" />}
                      {d.status === 'error' && <Badge kind="err">error</Badge>}
                      {e && <Badge kind={e.ds.version.startsWith('v3') ? 'v3' : 'info'}>{e.ds.version}</Badge>}
                    </div>
                    {e ? (
                      <div className="tiny muted ellipsis">
                        {e.ds.robotType} · {label(EMBODIMENT_LABEL, e.sem.embodiment)} · {e.ds.episodes.length} eps · {e.ds.fps} fps
                        {e.issues.some((i) => i.severity === 'error') ? ' · ⚠' : ''}
                      </div>
                    ) : (
                      <div className="tiny faint ellipsis">{d.error ?? d.root}</div>
                    )}
                  </div>
                )
              })}
          </div>
        ))}
      </div>
      {entry && (
        <>
          <div style={{ padding: '8px 12px 6px' }} className="row">
            <h4 className="grow">
              {L('Episodes', 'Episodes')} ({episodes.length})
            </h4>
            <input className="small" style={{ width: 130 }} placeholder={L('index / instruction', '编号 / 指令')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="row" style={{ padding: '0 12px 6px', gap: 6 }}>
            <select className="small grow" value={flagFilter} onChange={(e) => setFlagFilter(e.target.value as EpisodeFilter)}>
              <option value="all">{L('All episodes', '全部 episode')}</option>
              <option value="issues">{L('With QA issues', '有质量问题')}</option>
              <option value="review">? {L('Review', '待复查')} ({flagCounts.review})</option>
              <option value="exclude">✗ {L('Excluded', '已剔除')} ({flagCounts.exclude})</option>
              <option value="keep">✓ {L('Kept', '已保留')} ({flagCounts.keep})</option>
              <option value="unflagged">{L('Unflagged', '未标记')}</option>
            </select>
            <div style={{ position: 'relative' }}>
              <button className="small" onClick={() => setExportOpen((v) => !v)} title={L('Export episode lists for training filters', '导出 episode 列表，用于训练时过滤')}>
                ⬇ {L('Lists', '导出列表')}
              </button>
              {exportOpen && (
                <div className="panel" style={{ position: 'absolute', right: 0, top: 28, zIndex: 20, padding: 4, width: 230 }} onMouseLeave={() => setExportOpen(false)}>
                  {(
                    [
                      ['keep', L('episodes_keep.json (available − excluded)', 'episodes_keep.json（可用 − 已剔除）')],
                      ['exclude', L('episodes_exclude.json', 'episodes_exclude.json（剔除名单）')],
                      ['flags', L('episode_flags.json (flags, notes, issues)', 'episode_flags.json（标记+备注+问题）')],
                    ] as const
                  ).map(([k, label]) => (
                    <div key={k} className="list-item small" onClick={() => (exportCuration(entry, flags, k), setExportOpen(false))}>
                      {label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div ref={listRef} style={{ flex: 1, overflow: 'auto', position: 'relative' }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
            <div style={{ height: episodes.length * ROW, position: 'relative' }}>
              {episodes.slice(first, last).map((ep, i) => (
                <div
                  key={ep.index}
                  className={`list-item ${ep.index === episodeIndex ? 'active' : ''}`}
                  style={{ position: 'absolute', top: (first + i) * ROW, left: 0, right: 0, height: ROW, padding: '5px 12px', opacity: ep.available ? 1 : 0.4 }}
                  onClick={() => ep.available && selectEpisode(ep.index)}
                  title={ep.tasks.join('\n')}
                >
                  <div className="row small">
                    <span className="mono" style={{ width: 46 }}>
                      #{ep.index}
                    </span>
                    <span className="grow ellipsis muted">{ep.tasks[0] ?? ''}</span>
                    {flags?.[ep.index] && (
                      <span className={`flag-${flags[ep.index].flag}`} title={flags[ep.index].note ?? flags[ep.index].flag}>
                        {FLAG_ICON[flags[ep.index].flag]}
                      </span>
                    )}
                    {annotations?.[ep.index] && <span title={L('annotated', '已标注')}>🏷</span>}
                    <span className="faint tiny nowrap">{ep.length ? fmtDuration(ep.length / fps) : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
