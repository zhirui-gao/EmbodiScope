import { useMemo, useState } from 'react'
import type { DatasetEntry } from '@app/store'
import { useStore } from '@app/store'
import { EMBODIMENT_LABEL, LEVEL_LABEL, ROLE_LABEL, useL, useLabel } from '@app/i18n'
import { download, selectEpisode } from '@app/actions'
import { scanDataset } from '@app/scan'
import { ROTATION_LABELS } from '@core/math/rotation'
import { Badge, Histogram, Panel, ScoreBar, Stat, fmtBytes, fmtDuration, fmtNum } from '../common'
import { IssueList } from './QualityView'
import { FrameTree } from './SchemaView'
import { datasetMarkdown } from '@app/report'

export function OverviewView({ entry }: { entry: DatasetEntry }) {
  const L = useL()
  const label = useLabel()
  const lang = useStore((s) => s.lang)
  const set = useStore((s) => s.set)
  const { ds, sem, card } = entry
  const fps = ds.fps || 30
  const lengths = ds.episodes.map((e) => e.length / fps).filter((x) => x > 0)
  const [doc, setDoc] = useState<string | null>(null)
  const taskCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of ds.episodes) for (const t of e.tasks.length ? e.tasks : ['(none)']) m.set(t, (m.get(t) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1])
  }, [ds])
  const statsFeatures = ds.features.filter((f) => !f.isVideo && !f.isImage)

  return (
    <div className="view">
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="grow">
          <h2 className="row">
            {ds.name} <Badge kind={ds.version.startsWith('v3') ? 'v3' : 'info'}>LeRobot {ds.version}</Badge>
            <Badge kind="accent">{label(EMBODIMENT_LABEL, sem.embodiment)}</Badge>
            {sem.mobileBase && <Badge kind="accent">{L('mobile base', '移动底盘')}</Badge>}
          </h2>
          <div className="muted small mono">{ds.source.label}</div>
        </div>
        <button onClick={() => scanDataset(entry.id)} disabled={entry.scan?.status === 'running'}>
          🩺 {entry.scan?.status === 'done' ? L('Re-run quality scan', '重新质量扫描') : L('Run quality scan', '运行质量扫描')}
        </button>
        <button onClick={() => download(`${ds.name}_report.md`, datasetMarkdown(entry, lang), 'text/markdown')}>⬇ {L('Report', '导出报告')}</button>
      </div>

      <div className="grid g4" style={{ marginBottom: 12 }}>
        <Stat k={L('Episodes', 'Episodes')} v={card.episodes.toLocaleString()} s={card.availableEpisodes !== card.episodes ? L(`${card.availableEpisodes} present locally`, `本地存在 ${card.availableEpisodes} 个`) : `${ds.tasks.length} tasks`} />
        <Stat k={L('Frames / duration', '帧数 / 时长')} v={card.frames.toLocaleString()} s={`${fmtDuration(card.frames / fps)} @ ${fps} fps`} />
        <Stat k={L('Episode length', 'Episode 时长')} v={fmtDuration(card.episodeSeconds.median)} s={`p05 ${fmtDuration(card.episodeSeconds.p05)} · p95 ${fmtDuration(card.episodeSeconds.p95)}`} />
        <Stat k={L('Cameras', '相机')} v={card.cameras.length} s={card.cameras.map((c) => `${c.name} ${c.resolution}`).join(' · ') || '—'} />
      </div>

      <div className="grid g3" style={{ marginBottom: 12 }}>
        <Panel title={L('Embodiment & action space', '本体与动作空间')}>
          <div className="kv">
            <span>robot_type</span>
            <span className="mono">{ds.robotType}</span>
            <span>{L('Embodiment', '本体类型')}</span>
            <span>
              {label(EMBODIMENT_LABEL, sem.embodiment)} <span className="faint tiny">{sem.embodimentEvidence.join('; ')}</span>
            </span>
            <span>{L('End effector', '末端执行器')}</span>
            <span>{sem.endEffector}</span>
            <span>{L('State', '状态')}</span>
            <span>
              <b>{card.stateDim}D</b> <span className="muted tiny">{card.stateComposition}</span>
            </span>
            <span>{L('Action', '动作')}</span>
            <span>
              <b>{card.actionDim}D</b> <span className="muted tiny">{card.actionComposition}</span>
            </span>
            <span>{L('Action space', '动作空间')}</span>
            <span>
              {card.actionSpace} · <span className="muted">{card.actionType}</span>
            </span>
          </div>
        </Panel>
        <Panel title={L('Conventions', '坐标与单位约定')} actions={<Badge kind={card.conventionDeclared ? 'ok' : 'warn'}>{card.conventionDeclared ? L('declared', '已声明') : L('inferred', '推断')}</Badge>}>
          <div className="kv">
            <span>{L('Rotation', '旋转表示')}</span>
            <span>{card.rotationReprs.map((r) => ROTATION_LABELS[r]).join(' · ') || '—'}</span>
            <span>{L('Quaternion order', '四元数顺序')}</span>
            <span className="mono">{card.quaternionOrder}</span>
            <span>{L('Reference frames', '参考坐标系')}</span>
            <span className="mono">{card.referenceFrames.join(', ') || '—'}</span>
            <span>{L('Units', '单位')}</span>
            <span>
              {L('length', '长度')} {card.lengthUnits} · {L('angle', '角度')} {card.angleUnits}
            </span>
            <span>{L('Gripper', '夹爪')}</span>
            <span>{card.gripperPolarity.replace(/open_high/g, L('1 = open', '1 = 张开')).replace(/closed_high/g, L('1 = closed', '1 = 闭合'))}</span>
            <span>{L('Camera model', '相机模型')}</span>
            <span>
              {sem.conventions.cameraConvention ?? '—'} · {L('intrinsics', '内参')} {card.hasIntrinsics ? '✓' : '✗'} · {L('extrinsics', '外参')} {card.hasExtrinsics ? '✓' : '✗'} · {L('depth', '深度')} {card.hasDepth ? '✓' : '✗'}
            </span>
          </div>
        </Panel>
        <Panel title={L('Annotation granularity', '标注精细度')} actions={<ScoreBar value={card.annotation.granularityScore} />}>
          <div className="row wrap" style={{ marginBottom: 8 }}>
            {Object.keys(LEVEL_LABEL).map((lv) => (
              <Badge key={lv} kind={card.annotation.levels.includes(lv as any) ? 'ok' : undefined}>
                {card.annotation.levels.includes(lv as any) ? '✓' : '·'} {label(LEVEL_LABEL, lv)}
              </Badge>
            ))}
          </div>
          <div className="kv">
            <span>{L('Unique instructions', '不同指令数')}</span>
            <span>{card.annotation.uniqueInstructions}</span>
            <span>{L('Words / instruction', '指令词数')}</span>
            <span>
              {fmtNum(card.annotation.instructionWords.median, 1)} ({fmtNum(card.annotation.instructionWords.min, 0)}–{fmtNum(card.annotation.instructionWords.max, 0)})
            </span>
            <span>{L('Vocabulary', '词表大小')}</span>
            <span>{card.annotation.vocabularySize}</span>
            {card.annotation.subtasksPerEpisode != null && (
              <>
                <span>{L('Subtasks / episode', '子任务数/episode')}</span>
                <span>{fmtNum(card.annotation.subtasksPerEpisode, 1)}</span>
              </>
            )}
            {card.annotation.sources.length > 0 && (
              <>
                <span>{L('Sources', '来源')}</span>
                <span className="tiny mono">{card.annotation.sources.join(', ')}</span>
              </>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid g2" style={{ marginBottom: 12 }}>
        <Panel title={L('Episode duration distribution', 'Episode 时长分布')}>
          <Histogram values={lengths} unit="s" />
        </Panel>
        <Panel title={`${L('Instructions', '语言指令')} (${taskCounts.length})`} bodyStyle={{ maxHeight: 200, overflow: 'auto', padding: 0 }}>
          <table className="t">
            <tbody>
              {taskCounts.slice(0, 200).map(([t, n]) => (
                <tr key={t}>
                  <td>{t}</td>
                  <td className="right muted nowrap">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="grid g2" style={{ marginBottom: 12 }}>
        <Panel title={L('Cameras', '相机')} bodyStyle={{ padding: 0 }}>
          <table className="t">
            <thead>
              <tr>
                <th>{L('Name', '名称')}</th>
                <th>{L('Mount', '安装位置')}</th>
                <th>{L('Resolution', '分辨率')}</th>
                <th>codec</th>
                <th>fps</th>
                <th>{L('Calibration', '标定')}</th>
              </tr>
            </thead>
            <tbody>
              {sem.cameras.map((c) => (
                <tr key={c.key}>
                  <td className="mono">{c.key}</td>
                  <td>{c.mount}</td>
                  <td>{c.width && c.height ? `${c.width}×${c.height}` : '?'}</td>
                  <td>{c.codec ?? <span className="faint">{L('scan to probe', '扫描后获取')}</span>}</td>
                  <td>{c.fps ?? '—'}</td>
                  <td className="tiny">
                    {c.intrinsics ? 'K ' : ''}
                    {c.extrinsics ? `T→${c.extrinsics.parent ?? '?'}` : ''}
                    {!c.intrinsics && !c.extrinsics ? '—' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title={L('Reference frame tree', '参考坐标系树')}>
          <FrameTree sem={sem} />
        </Panel>
      </div>

      <Panel
        title={L('Issues found so far', '当前发现的问题')}
        actions={
          <button className="small" onClick={() => set({ tab: 'quality' })}>
            {L('Open quality tab', '查看质量检测')} →
          </button>
        }
      >
        <IssueList issues={entry.issues} limit={6} onEpisode={selectEpisode} />
        {!entry.scan && <p className="muted small">{L('Only metadata checks so far — run a quality scan for per-frame checks.', '目前仅包含元数据检查 —— 运行质量扫描以获得逐帧检查结果。')}</p>}
      </Panel>

      <div className="section-title">
        <h3>{L('Features', '特征列表')}</h3>
        <span className="muted small">{statsFeatures.length}</span>
      </div>
      <div className="panel" style={{ maxHeight: 460, overflow: 'auto' }}>
        <table className="t">
          <thead>
            <tr>
              <th>key</th>
              <th>dtype</th>
              <th>shape</th>
              <th>{L('Interpretation', '语义解释')}</th>
              <th>min … max ({L('first dims', '前几维')})</th>
            </tr>
          </thead>
          <tbody>
            {statsFeatures.map((f) => {
              const segs = sem.segments.filter((s) => s.feature === f.key)
              const st = ds.stats?.[f.key]
              const n = Math.min(4, st?.min?.length ?? 0)
              return (
                <tr key={f.key}>
                  <td className="mono">{f.key}</td>
                  <td>{f.dtype}</td>
                  <td>{f.shape.join('×')}</td>
                  <td className="tiny">
                    {segs.map((s) => (
                      <div key={s.id}>
                        <Badge kind={s.role === 'unknown' ? 'warn' : s.overridden ? 'accent' : undefined}>{label(ROLE_LABEL, s.role)}</Badge> {s.side ?? ''} {s.start || s.end !== f.dim ? <span className="faint">[{s.start}:{s.end}]</span> : null}{' '}
                        {s.pose?.rot && <span className="muted">{s.pose.rot.repr}{s.pose.rot.ambiguous ? '?' : ''}</span>} {s.pose?.parent && <span className="faint">→{s.pose.parent}</span>}
                      </div>
                    ))}
                  </td>
                  <td className="tiny mono muted">
                    {n
                      ? Array.from({ length: n }, (_, i) => `${fmtNum(st!.min![i])}…${fmtNum(st!.max![i])}`).join('  ') + (st!.min!.length > n ? ' …' : '')
                      : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {(ds.extras.documents.length > 0 || ds.extras.vocabularies.length > 0) && (
        <>
          <div className="section-title">
            <h3>{L('Sidecar metadata', '附加元数据')}</h3>
          </div>
          <div className="row wrap">
            {ds.extras.vocabularies.map((v) => (
              <span key={v.file} className="chip" onClick={() => setDoc(`${v.file}\n\n${[...v.labels].map(([k, t]) => `${k}: ${t}`).join('\n')}`)}>
                🏷 {v.name} ({v.labels.size})
              </span>
            ))}
            {ds.extras.documents.map((d) => (
              <span key={d.path} className="chip" onClick={() => setDoc(`${d.path}\n\n${d.text}`)}>
                📄 {d.path}
              </span>
            ))}
          </div>
          {doc && <div className="pre" style={{ marginTop: 8 }}>{doc}</div>}
        </>
      )}
      <p className="faint tiny" style={{ marginTop: 16 }}>
        {L('Loaded in', '加载耗时')} {Math.round(ds.loadMs)} ms · {L('size', '大小')} {fmtBytes(ds.totalBytes)}
      </p>
    </div>
  )
}
