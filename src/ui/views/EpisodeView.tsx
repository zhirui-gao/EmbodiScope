import { useEffect, useMemo, useState } from 'react'
import type { DatasetEntry } from '@app/store'
import { useStore } from '@app/store'
import { useEpisode } from '@app/episodeCache'
import { playback } from '@app/playback'
import { useL } from '@app/i18n'
import { selectEpisode } from '@app/actions'
import { buildSceneModel } from '../scene/model'
import { Scene3D } from '../scene/Scene3D'
import { VideoTile } from '../episode/VideoTile'
import { ImageTile } from '../episode/ImageTile'
import { FlagBar } from '../episode/FlagBar'
import { takePendingFrame } from '@app/deeplink'
import { AnnotationEditor } from '../episode/AnnotationEditor'
import { RobotPanel } from '../episode/RobotPanel'
import { useRobot } from '@app/robotModel'
import { useTerm } from '@app/terms'
import { Timeline, Transport, useCurrentSegments } from '../episode/Timeline'
import { buildTracks } from '../episode/tracks'
import { buildChartGroups } from '../episode/charts'
import { SignalChart } from '../episode/SignalChart'
import { FrameInspector } from '../episode/FrameInspector'
import { Badge, Panel, fmtDuration } from '../common'

export function EpisodeView({ entry }: { entry: DatasetEntry }) {
  const L = useL()
  const episodeIndex = useStore((s) => s.episodeIndex)
  const annotation = useStore((s) => (episodeIndex != null ? s.annotations[entry.id]?.[episodeIndex] : undefined))
  const showOverlay = useStore((s) => s.settings.showOverlay)
  const updateSettings = useStore((s) => s.updateSettings)
  const available = entry.ds.episodes.filter((e) => e.available)
  useEffect(() => {
    if (episodeIndex == null && available.length) useStore.getState().set({ episodeIndex: available[0].index })
  }, [entry.id, episodeIndex])
  const { data, loading, error } = useEpisode(entry, episodeIndex)
  const ep = data?.info
  const table = data?.table
  const fps = entry.ds.fps || 30

  useEffect(() => {
    if (!table || !ep) return
    playback.reset(table.length, fps)
    const f = takePendingFrame(entry.id, ep.index)
    if (f != null) playback.seek(f)
  }, [table, fps])

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const idx = available.findIndex((x) => x.index === episodeIndex)
      if (e.key === ' ') {
        e.preventDefault()
        playback.toggle()
      } else if (e.key === 'ArrowRight') playback.step(e.shiftKey ? 10 : 1)
      else if (e.key === 'ArrowLeft') playback.step(e.shiftKey ? -10 : -1)
      else if (e.key === 'Home') playback.seek(0)
      else if (e.key === 'End') playback.seek(playback.length - 1)
      else if (e.key === ']' && idx < available.length - 1) selectEpisode(available[idx + 1].index)
      else if (e.key === '[' && idx > 0) selectEpisode(available[idx - 1].index)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [episodeIndex, available])

  const robot = useRobot(entry)
  const model = useMemo(() => (table ? buildSceneModel(entry, table, robot) : null), [table, entry.version, robot, robot?.map])
  const tracks = useMemo(() => (table && ep ? buildTracks(entry, ep.index, table, annotation) : []), [table, ep, annotation, entry.version])
  const lang = useStore((s) => s.lang)
  const T = useTerm()
  const groups = useMemo(() => (table ? buildChartGroups(entry.sem, table, lang) : []), [table, entry.version, lang])
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [showInspector, setShowInspector] = useState(false)
  const current = useCurrentSegments(tracks)
  const isVideo = (key: string) => Boolean(entry.ds.features.find((f) => f.key === key)?.isVideo)
  const cams = entry.sem.cameras
  const has3d = Boolean(model && (model.tracks.length || model.skeleton || model.robot))
  const jointOnly = entry.sem.segments.some((s) => s.role === 'joint_position' && s.stream === 'observation')
  const chartsPerRow = useStore((s) => s.settings.chartsPerRow)

  if (!available.length) return <div className="view muted">{L('No episode data files are present in this copy of the dataset.', '该数据集副本中没有任何 episode 数据文件。')}</div>
  if (loading || (!data && !error)) return <div className="view muted">{L('Loading episode …', '正在加载 episode …')}</div>
  if (error || !ep || !table) return <div className="view" style={{ color: 'var(--err)' }}>{error}</div>

  const idx = available.findIndex((x) => x.index === ep.index)
  const visibleGroups = groups.filter((g) => !hidden.has(g.id))
  const camCols = cams.length <= 1 ? 1 : cams.length <= 4 ? 2 : 3

  return (
    <div className="view tight">
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="small" disabled={idx <= 0} onClick={() => selectEpisode(available[idx - 1].index)} title="[">
          ‹
        </button>
        <h2 className="nowrap">Episode {ep.index}</h2>
        <button className="small" disabled={idx >= available.length - 1} onClick={() => selectEpisode(available[idx + 1].index)} title="]">
          ›
        </button>
        <Badge title={`${L('loaded in', '加载耗时')} ${Math.round(data.loadMs)} ms`}>
          {table.length} {L('frames', '帧')}
        </Badge>
        <Badge>{fmtDuration(table.length / fps)}</Badge>
        <span className="grow ellipsis" title={ep.tasks.join('\n')} style={{ fontSize: 13 }}>
          💬 {ep.tasks.join(' · ') || <span className="faint">{L('(no instruction)', '（无指令）')}</span>}
        </span>
        <FlagBar datasetId={entry.id} episode={ep.index} />
        <label className="row small muted nowrap">
          <input type="checkbox" checked={showOverlay} onChange={(e) => updateSettings((s) => ({ ...s, showOverlay: e.target.checked }))} />
          {L('projection overlay', '投影叠加')}
        </label>
      </div>
      {current.length > 0 && (
        <div className="row wrap" style={{ marginBottom: 6 }}>
          {current.map((c) => (
            <span key={c.track} className="badge accent" title={c.track}>
              ▸ {T(c.seg!.text)}
            </span>
          ))}
        </div>
      )}
      <div className={`episode-layout ${has3d || jointOnly ? '' : 'no3d'}`} style={{ height: 'auto' }}>
        <div className="col" style={{ minWidth: 0 }}>
          {cams.length > 0 ? (
            <div className={`video-grid ${cams.length > 2 ? 'many' : ''}`} style={{ gridTemplateColumns: `repeat(${camCols}, minmax(0, 1fr))` }}>
              {cams.map((c) =>
                isVideo(c.key) ? (
                  <VideoTile key={`${ep.index}-${c.key}`} entry={entry} ep={ep} cam={c} model={model} />
                ) : (
                  <ImageTile key={`${ep.index}-${c.key}`} entry={entry} ep={ep} cam={c} />
                ),
              )}
            </div>
          ) : (
            <div className="panel panel-body muted">{L('This dataset has no video streams.', '该数据集没有视频流。')}</div>
          )}
          <Transport length={table.length} fps={fps} />
        </div>
        {(has3d || jointOnly) && model && (
          <div className="col" style={{ minHeight: 360, gap: 6 }}>
            {jointOnly && <RobotPanel entry={entry} expanded={!has3d} />}
            {has3d ? (
              <div style={{ flex: 1, display: 'flex', minHeight: 320 }}>
                <div style={{ flex: 1 }}>
                  <Scene3D model={model} />
                </div>
              </div>
            ) : (
              <div className="panel panel-body muted small" style={{ flex: 1 }}>
                {L(
                  'This dataset only records joint angles. Load the robot URDF above to see it in 3D (forward kinematics).',
                  '该数据集只记录关节角。在上方加载机器人 URDF，即可通过正运动学在 3D 中查看机器人（可选）。',
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <Panel title={L('Timeline', '时间轴')} className="" bodyStyle={{ padding: '6px 10px' }}>
        <Timeline tracks={tracks} length={table.length} />
        <AnnotationEditor entry={entry} episode={ep.index} table={table} />
      </Panel>
      <div className="section-title">
        <h3>{L('Signals', '信号曲线')}</h3>
        <span className="muted tiny">{L('solid = observation, dashed = paired action · click a plot to seek', '实线 = 观测，虚线 = 对应动作 · 点击曲线定位')}</span>
        <span className="spacer" />
        <select className="small" value={chartsPerRow} onChange={(e) => updateSettings((s) => ({ ...s, chartsPerRow: Number(e.target.value) }))}>
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n} / {L('row', '行')}
            </option>
          ))}
        </select>
        <button className="small" onClick={() => setShowInspector((v) => !v)}>
          {showInspector ? L('Hide frame values', '隐藏帧数值') : L('Frame values', '帧数值')}
        </button>
      </div>
      {showInspector && (
        <Panel>
          <FrameInspector table={table} sem={entry.sem} extra={ep.extra} />
        </Panel>
      )}
      <div className="row wrap" style={{ margin: '6px 0' }}>
        {groups.map((g) => (
          <span
            key={g.id}
            className="chip"
            style={{ opacity: hidden.has(g.id) ? 0.4 : 1 }}
            onClick={() =>
              setHidden((h) => {
                const n = new Set(h)
                n.has(g.id) ? n.delete(g.id) : n.add(g.id)
                return n
              })
            }
          >
            {g.title.split(' · ')[0]} <span className="faint">{g.id.length > 34 ? '…' + g.id.slice(-32) : g.id}</span>
          </span>
        ))}
      </div>
      <div className="chart-grid" style={{ gridTemplateColumns: `repeat(${chartsPerRow}, minmax(0, 1fr))` }}>
        {visibleGroups.slice(0, 40).map((g) => (
          <SignalChart key={`${ep.index}-${g.id}`} title={g.title} series={g.series} length={table.length} syncKey={`ep-${entry.id}`} />
        ))}
      </div>
    </div>
  )
}
