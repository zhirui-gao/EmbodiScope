import { useState } from 'react'
import type { DatasetEntry } from '@app/store'
import { useStore } from '@app/store'
import { ROLE_LABEL, useL, useLabel } from '@app/i18n'
import { download, refreshDerived } from '@app/actions'
import { applyOverride, clearOverrides, saveOverride, schemaSignature, toSpec } from '@app/overrides'
import type { SegmentOverride } from '@app/overrides'
import { ROTATION_DIMS, ROTATION_LABELS } from '@core/math/rotation'
import type { RotationRepr } from '@core/math/rotation'
import type { DatasetSemantics, Role, Segment } from '@core/semantics/types'
import { matchingProfiles } from '@core/semantics/profiles'
import { Badge, Panel } from '../common'
import { runFormatAnalysis } from './AiView'
import { DimStats } from './DimStats'

const ROLES = Object.keys(ROLE_LABEL) as Role[]

export function FrameTree({ sem }: { sem: DatasetSemantics }) {
  const L = useL()
  const edges = sem.frames
  if (!edges.length) return <div className="muted small">{L('No pose features with reference frames.', '没有带参考系的位姿特征。')}</div>
  const children = new Map<string, string[]>()
  const isChild = new Set<string>()
  for (const e of edges) {
    if (!children.has(e.parent)) children.set(e.parent, [])
    if (!children.get(e.parent)!.includes(e.child)) children.get(e.parent)!.push(e.child)
    isChild.add(e.child)
  }
  const roots = [...children.keys()].filter((p) => !isChild.has(p))
  const render = (n: string, depth: number, seen: Set<string>): JSX.Element => (
    <div key={n + depth}>
      <div style={{ paddingLeft: depth * 18 }}>
        {depth > 0 ? '└─ ' : '◉ '}
        <span style={{ color: depth === 0 ? 'var(--accent)' : n.includes('camera') ? '#e3b341' : 'var(--text)' }}>{n}</span>
      </div>
      {!seen.has(n) && (children.get(n) ?? []).map((c) => render(c, depth + 1, new Set([...seen, n])))}
    </div>
  )
  return (
    <div className="frame-tree">
      {(roots.length ? roots : [...children.keys()]).map((r) => render(r, 0, new Set()))}
      <div className="faint tiny" style={{ marginTop: 6 }}>
        {L('Edges come from “<child>_to_<parent>” feature names and pose roles.', '边来自 “<child>_to_<parent>” 形式的特征名与位姿角色。')}
      </div>
    </div>
  )
}

export function SchemaView({ entry }: { entry: DatasetEntry }) {
  const L = useL()
  const label = useLabel()
  const lang = useStore((s) => s.lang)
  const { ds, sem } = entry
  const [showIndex, setShowIndex] = useState(false)
  const [busy, setBusy] = useState(false)
  const notify = useStore((s) => s.notify)
  const profiles = matchingProfiles(ds)

  const change = (seg: Segment, o: Omit<SegmentOverride, 'id' | 'source'>, source: 'user' | 'llm' = 'user') => {
    const ov: SegmentOverride = { id: seg.id, source, ...o }
    applyOverride(seg, ov)
    saveOverride(ds, ov)
    refreshDerived(entry.id)
  }
  const rows = sem.segments.filter((s) => showIndex || (s.role !== 'index' && s.role !== 'camera'))
  const fa = entry.formatAnalysis

  const applyAnalysis = () => {
    if (!fa) return
    let n = 0
    for (const f of fa.features ?? []) {
      const m = f.slice?.match(/\[(\d+):(\d+)\]/)
      const seg = sem.segments.find((s) => s.feature === f.key && (!m || (s.start === Number(m[1]) && s.end === Number(m[2]))))
      if (!seg) continue
      const o: Omit<SegmentOverride, 'id' | 'source'> = {}
      if (f.role && ROLES.includes(f.role as Role) && f.role !== seg.role) o.role = f.role as Role
      if (f.rotation && seg.pose?.rot && f.rotation in ROTATION_DIMS && ROTATION_DIMS[f.rotation as RotationRepr] === seg.pose.rot.idx.length && f.rotation !== seg.pose.rot.repr) o.rotation = f.rotation
      if (f.side === 'left' || f.side === 'right') o.side = f.side
      if (Object.keys(o).length) {
        change(seg, o, 'llm')
        n++
      }
    }
    notify(lang === 'zh' ? `已应用 ${n} 项 AI 建议` : `Applied ${n} AI suggestion(s)`)
  }

  return (
    <div className="view">
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="grow">
          <h2>{L('Signal semantics', '信号语义')}</h2>
          <div className="muted small">
            {L(
              'How every vector was interpreted. Edit any cell — corrections are stored for this schema signature and reused next time.',
              '每个向量被如何解释。可直接修改任意单元格 —— 修正会按该数据结构签名保存，下次自动复用。',
            )}{' '}
            <span className="mono faint">{schemaSignature(ds)}</span>
          </div>
        </div>
        <label className="row small muted">
          <input type="checkbox" checked={showIndex} onChange={(e) => setShowIndex(e.target.checked)} /> {L('show index & video', '显示索引与视频')}
        </label>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await runFormatAnalysis(entry)
            } finally {
              setBusy(false)
            }
          }}
        >
          🤖 {busy ? L('Analysing …', '分析中 …') : L('AI format analysis', 'AI 格式分析')}
        </button>
        <button onClick={() => download(`${ds.name}.embodispec.json`, JSON.stringify(toSpec(ds, sem), null, 2))}>⬇ EmbodiSpec</button>
        <button
          className="ghost"
          onClick={() => {
            clearOverrides(ds)
            notify(lang === 'zh' ? '已清除修正，重新加载数据集后生效' : 'Overrides cleared — reload the dataset to re-infer')
          }}
        >
          {L('Reset', '重置修正')}
        </button>
      </div>
      {profiles.length > 0 && (
        <div className="row wrap" style={{ marginBottom: 8 }}>
          <span className="muted small">{L('Dataset profiles applied:', '已应用的数据集配置：')}</span>
          {profiles.map((p) => (
            <Badge key={p.id} kind="accent" title={p.reference}>
              {p.label}
            </Badge>
          ))}
        </div>
      )}
      {sem.notes.map((n) => (
        <div key={n} className="issue warning small" style={{ marginBottom: 6 }}>
          {n}
        </div>
      ))}
      <div className="panel" style={{ overflow: 'auto', maxHeight: '58vh' }}>
        <table className="t">
          <thead>
            <tr>
              <th>{L('Segment', '片段')}</th>
              <th>stream</th>
              <th>{L('Role', '角色')}</th>
              <th>{L('Side', '侧')}</th>
              <th>{L('Rotation', '旋转表示')}</th>
              <th>{L('Frame', '坐标系')}</th>
              <th>{L('Units', '单位')}</th>
              <th>{L('Gripper / action', '夹爪 / 动作')}</th>
              <th>{L('Confidence', '置信度')}</th>
              <th>{L('Evidence', '依据')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="mono">{s.id}</div>
                  <div className="tiny faint ellipsis" style={{ maxWidth: 260 }} title={s.names.join(', ')}>
                    {s.names.slice(0, 8).join(', ')}
                    {s.names.length > 8 ? ' …' : ''}
                  </div>
                </td>
                <td className="tiny">{s.stream}</td>
                <td>
                  <select className="seg-select" value={s.role} onChange={(e) => change(s, { role: e.target.value as Role })}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {label(ROLE_LABEL, r)}
                      </option>
                    ))}
                  </select>
                  {s.overridden && <Badge kind="accent">{s.overridden}</Badge>}
                </td>
                <td>
                  <select className="seg-select" value={s.side ?? ''} onChange={(e) => change(s, { side: (e.target.value || null) as any })}>
                    <option value="">—</option>
                    <option value="left">left</option>
                    <option value="right">right</option>
                    <option value="center">center</option>
                  </select>
                </td>
                <td>
                  {s.pose?.rot ? (
                    <select
                      className="seg-select"
                      value={s.pose.rot.repr}
                      onChange={(e) => change(s, { rotation: e.target.value })}
                      style={s.pose.rot.ambiguous ? { borderColor: 'var(--warn)' } : undefined}
                      title={s.pose.rot.ambiguous ? L('ambiguous — please verify', '存在歧义 —— 请核实') : ''}
                    >
                      {(Object.keys(ROTATION_LABELS) as RotationRepr[])
                        .filter((r) => ROTATION_DIMS[r] === s.pose!.rot!.idx.length)
                        .map((r) => (
                          <option key={r} value={r}>
                            {ROTATION_LABELS[r]}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <span className="faint">—</span>
                  )}
                  {s.pose?.rot?.ambiguous && <span title="ambiguous"> ⚠</span>}
                </td>
                <td className="mono tiny">{s.pose?.parent ? `${s.pose.child ?? ''} → ${s.pose.parent}` : s.pose ? 'implicit' : ''}</td>
                <td className="tiny">{s.units ? Object.entries(s.units).map(([k, v]) => `${k}:${v}`).join(' ') : ''}</td>
                <td>
                  {s.role === 'gripper' && (
                    <select className="seg-select" value={s.gripper?.polarity ?? 'unknown'} onChange={(e) => change(s, { gripperPolarity: e.target.value as any })}>
                      <option value="open_high">{L('1 = open', '1 = 张开')}</option>
                      <option value="closed_high">{L('1 = closed', '1 = 闭合')}</option>
                      <option value="unknown">?</option>
                    </select>
                  )}
                  {(s.stream === 'action' || s.stream === 'teleop') && (
                    <select className="seg-select" value={s.actionType ?? 'unknown'} onChange={(e) => change(s, { actionType: e.target.value as any })}>
                      <option value="absolute">absolute</option>
                      <option value="delta">delta</option>
                      <option value="velocity">velocity</option>
                      <option value="unknown">?</option>
                    </select>
                  )}
                  {s.pairedWith && <div className="tiny faint">⟷ {s.pairedWith}</div>}
                </td>
                <td>
                  <div className="progress" style={{ width: 50 }}>
                    <div style={{ width: `${s.confidence * 100}%` }} />
                  </div>
                </td>
                <td className="tiny muted" style={{ maxWidth: 300 }}>
                  {s.evidence.join('; ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid g2" style={{ marginTop: 12 }}>
        <Panel title={L('Reference frame tree', '参考坐标系树')}>
          <FrameTree sem={sem} />
        </Panel>
        <Panel title={L('Cameras', '相机模型')}>
          <table className="t">
            <thead>
              <tr>
                <th>{L('camera', '相机')}</th>
                <th>{L('mount', '安装')}</th>
                <th>{L('intrinsics', '内参')}</th>
                <th>{L('extrinsics', '外参')}</th>
                <th>{L('optical convention', '光学约定')}</th>
              </tr>
            </thead>
            <tbody>
              {sem.cameras.map((c) => (
                <tr key={c.key}>
                  <td className="mono">{c.name}</td>
                  <td>{c.mount}</td>
                  <td className="mono tiny">{c.intrinsics?.feature ?? '—'}</td>
                  <td className="mono tiny">{c.extrinsics ? `${c.extrinsics.segment} → ${c.extrinsics.parent ?? '?'}` : '—'}</td>
                  <td>{c.convention}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel title={L('Per-dimension statistics', '逐维统计')} className="">
        <DimStats entry={entry} />
      </Panel>

      {fa && (
        <Panel
          title={L('AI format analysis', 'AI 格式分析结果')}
          actions={
            <button className="small primary" onClick={applyAnalysis}>
              {L('Apply role / rotation suggestions', '应用角色/旋转建议')}
            </button>
          }
          className=""
        >
          <p>{fa.summary}</p>
          <div className="kv" style={{ marginBottom: 10 }}>
            {fa.embodiment && (
              <>
                <span>{L('Embodiment', '本体')}</span>
                <span>{fa.embodiment}</span>
              </>
            )}
            {fa.action_semantics && (
              <>
                <span>{L('Action semantics', '动作语义')}</span>
                <span>{fa.action_semantics}</span>
              </>
            )}
            {fa.annotation_granularity && (
              <>
                <span>{L('Annotation', '标注')}</span>
                <span>{fa.annotation_granularity}</span>
              </>
            )}
          </div>
          {fa.coordinate_frames?.length ? (
            <>
              <h4>{L('Coordinate frames', '坐标系')}</h4>
              <ul className="small">
                {fa.coordinate_frames.map((c) => (
                  <li key={c.name}>
                    <b className="mono">{c.name}</b>: {c.description}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <div style={{ maxHeight: 360, overflow: 'auto' }}>
            <table className="t">
              <thead>
                <tr>
                  <th>key</th>
                  <th>role</th>
                  <th>{L('meaning', '含义')}</th>
                  <th>{L('frame', '坐标系')}</th>
                  <th>{L('rotation', '旋转')}</th>
                  <th>{L('units', '单位')}</th>
                </tr>
              </thead>
              <tbody>
                {(fa.features ?? []).map((f, i) => (
                  <tr key={i}>
                    <td className="mono tiny">
                      {f.key}
                      {f.slice ?? ''}
                    </td>
                    <td className="tiny">
                      {f.role} {f.side ?? ''}
                    </td>
                    <td className="small">{f.meaning}</td>
                    <td className="tiny">{f.reference_frame}</td>
                    <td className="tiny">{f.rotation}</td>
                    <td className="tiny">{f.units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid g2" style={{ marginTop: 10 }}>
            <div>
              <h4>{L('Issues', '问题')}</h4>
              <ul className="small">{(fa.issues ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
            <div>
              <h4>{L('Training recommendations', '训练建议')}</h4>
              <ul className="small">{(fa.training_recommendations ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          </div>
        </Panel>
      )}
    </div>
  )
}
