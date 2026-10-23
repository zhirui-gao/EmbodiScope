import { useMemo } from 'react'
import { useStore } from '@app/store'
import type { DatasetEntry } from '@app/store'
import { useL } from '@app/i18n'
import { download } from '@app/actions'
import { cardRows } from '@app/report'
import type { DatasetCard } from '@core/analysis/summary'
import { scanDataset } from '@app/scan'
import { Histogram, PALETTE, Panel } from '../common'
import { WorkspacePlot } from './QualityView'

interface Harmonize {
  en: string
  zh: string
}

/** Differences that must be reconciled before co-training on several datasets. */
export function harmonizationNotes(cards: DatasetCard[]): Harmonize[] {
  const out: Harmonize[] = []
  const uniq = <T,>(f: (c: DatasetCard) => T) => [...new Set(cards.map(f))]
  const fps = uniq((c) => c.fps)
  if (fps.length > 1) out.push({ en: `Frame rates differ (${fps.join(', ')} fps): resample or use time-based action horizons.`, zh: `帧率不同（${fps.join('、')} fps）：需要重采样，或用基于时间的动作时域。` })
  const q = uniq((c) => c.quaternionOrder).filter((x) => x !== 'none')
  if (q.length > 1) out.push({ en: `Quaternion orders differ (${q.join(' vs ')}): convert to a single order.`, zh: `四元数顺序不同（${q.join(' vs ')}）：需统一顺序。` })
  const rot = uniq((c) => c.rotationReprs.join('+')).filter(Boolean)
  if (rot.length > 1) out.push({ en: `Rotation representations differ (${rot.join(' | ')}): map everything to one (e.g. 6D) for learning.`, zh: `旋转表示不同（${rot.join(' | ')}）：训练时建议统一映射到同一种（如 6D）。` })
  const space = uniq((c) => c.actionSpace)
  if (space.length > 1) out.push({ en: `Action spaces differ (${space.join(' | ')}): need per-embodiment action heads or a shared EEF space.`, zh: `动作空间不同（${space.join(' | ')}）：需要按本体区分的动作头或统一到末端空间。` })
  const types = uniq((c) => c.actionType)
  if (types.length > 1) out.push({ en: `Absolute vs delta/velocity actions are mixed (${types.join(' | ')}).`, zh: `绝对与增量/速度动作混用（${types.join(' | ')}）。` })
  const grip = uniq((c) => c.gripperPolarity).filter((x) => x !== '—')
  if (grip.length > 1) out.push({ en: `Gripper polarity / scale differs (${grip.join(' | ')}): normalise to 0 = closed … 1 = open.`, zh: `夹爪极性/量程不同（${grip.join(' | ')}）：建议统一归一化为 0 = 闭合 … 1 = 张开。` })
  const units = uniq((c) => `${c.lengthUnits}/${c.angleUnits}`)
  if (units.length > 1) out.push({ en: `Units differ (${units.join(' | ')}).`, zh: `单位不同（${units.join(' | ')}）。` })
  const frames = uniq((c) => c.referenceFrames.join(','))
  if (frames.length > 1) out.push({ en: `Poses are expressed in different reference frames (${frames.join(' | ')}): define a common base frame.`, zh: `位姿所在参考系不同（${frames.join(' | ')}）：需要定义统一的基坐标系。` })
  const cams = uniq((c) => c.cameras.length)
  if (cams.length > 1) out.push({ en: `Camera counts differ (${cams.join(', ')}): use camera dropout / masking.`, zh: `相机数量不同（${cams.join('、')}）：建议使用相机 dropout / mask。` })
  const res = uniq((c) => c.cameras.map((x) => x.resolution).join(','))
  if (res.length > 1) out.push({ en: 'Image resolutions / aspect ratios differ: check resizing and padding policy.', zh: '图像分辨率 / 宽高比不同：需确认缩放与填充策略。' })
  const emb = uniq((c) => c.embodiment)
  if (emb.length > 1) out.push({ en: `Embodiments differ (${emb.join(', ')}).`, zh: `本体类型不同（${emb.join('、')}）。` })
  const ann = uniq((c) => c.annotation.levels.includes('subtask_segments'))
  if (ann.length > 1) out.push({ en: 'Only some datasets have subtask annotations: hierarchical policies need consistent labels (use AI lab to fill the gap).', zh: '只有部分数据集具有子任务标注：分层策略需要一致的标注（可用 AI 标注补齐）。' })
  return out
}

export function CompareView() {
  const L = useL()
  const lang = useStore((s) => s.lang)
  const datasets = useStore((s) => s.datasets)
  const compareIds = useStore((s) => s.compareIds)
  const set = useStore((s) => s.set)
  const all = Object.values(datasets)
  const chosen: DatasetEntry[] = (compareIds.length ? compareIds.map((id) => datasets[id]).filter(Boolean) : all.slice(0, 8)) as DatasetEntry[]
  const cards = chosen.map((d) => d.card)
  const rows = useMemo(() => {
    const perDs = cards.map((c) => cardRows(c, lang))
    return perDs[0]?.map((r, i) => ({ key: r[0], values: perDs.map((p) => p[i][1]) })) ?? []
  }, [cards, lang])
  const notes = harmonizationNotes(cards)
  const toggle = (id: string) => {
    const cur = compareIds.length ? compareIds : all.slice(0, 8).map((d) => d.id)
    set({ compareIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
  }
  const md = () => {
    const head = `| | ${cards.map((c) => c.name).join(' | ')} |\n|---|${cards.map(() => '---').join('|')}|`
    return `# EmbodiScope dataset comparison\n\n${head}\n${rows.map((r) => `| ${r.key} | ${r.values.join(' | ')} |`).join('\n')}\n\n## ${lang === 'zh' ? '混合训练前需统一' : 'Harmonisation checklist'}\n\n${notes.map((n) => `- ${n[lang]}`).join('\n')}\n`
  }
  const csv = () => [['field', ...cards.map((c) => c.name)], ...rows.map((r) => [r.key, ...r.values])].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n')

  if (!all.length) return <div className="view muted">{L('Load some datasets first.', '请先加载数据集。')}</div>
  return (
    <div className="view">
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="grow">
          <h2>{L('Dataset comparison', '数据集对比')}</h2>
          <div className="muted small">{L('Highlighted cells differ across datasets.', '高亮单元格表示各数据集间存在差异。')}</div>
        </div>
        <button onClick={() => download('comparison.md', md(), 'text/markdown')}>⬇ Markdown</button>
        <button onClick={() => download('comparison.csv', csv(), 'text/csv')}>⬇ CSV</button>
        <button onClick={() => download('comparison.json', JSON.stringify(cards, null, 2))}>⬇ JSON</button>
      </div>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        {all.map((d) => (
          <label key={d.id} className="chip" style={{ fontFamily: 'inherit' }}>
            <input type="checkbox" checked={chosen.includes(d)} onChange={() => toggle(d.id)} /> {d.ds.name}
          </label>
        ))}
      </div>
      {notes.length > 0 && (
        <Panel title={L('Harmonisation checklist before co-training', '混合训练前需要统一的事项')}>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {notes.map((n, i) => (
              <li key={i}>{n[lang]}</li>
            ))}
          </ul>
        </Panel>
      )}
      <div className="panel" style={{ overflow: 'auto', marginTop: 12, maxHeight: '60vh' }}>
        <table className="t">
          <thead>
            <tr>
              <th />
              {cards.map((c, i) => (
                <th key={c.id} style={{ color: PALETTE[i % PALETTE.length] }}>
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const differs = new Set(r.values).size > 1
              return (
                <tr key={r.key}>
                  <td className="muted nowrap">{r.key}</td>
                  {r.values.map((v, i) => (
                    <td key={i} className={differs ? 'diff' : ''} style={{ minWidth: 160 }}>
                      {v}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="grid g2" style={{ marginTop: 12 }}>
        <Panel title={L('Episode duration (normalised histogram)', 'Episode 时长分布（归一化）')}>
          <Histogram series={chosen.map((d, i) => ({ name: d.ds.name, color: PALETTE[i % PALETTE.length], values: d.ds.episodes.map((e) => e.length / (d.ds.fps || 30)).filter((x) => x > 0) }))} unit="s" height={160} />
        </Panel>
        <Panel
          title={L('EEF workspace (requires quality scan)', '末端工作空间（需先质量扫描）')}
          actions={
            <button className="small" onClick={() => chosen.filter((d) => !d.scan).forEach((d) => scanDataset(d.id, { maxEpisodes: 200 }))}>
              {L('Scan missing', '扫描缺失项')}
            </button>
          }
        >
          <WorkspacePlot
            points={chosen
              .map((d, i) => ({
                label: d.ds.name,
                color: PALETTE[i % PALETTE.length],
                pts: (d.scan?.metrics ?? []).flatMap((m) => Object.values(m.workspace)[0] ?? []),
              }))
              .filter((p) => p.pts.length)}
            axes={[0, 1]}
          />
          <div className="faint tiny">{L('Different reference frames are overlaid as-is — the offset itself is informative.', '不同参考系按原样叠加 —— 偏移本身就能说明问题。')}</div>
        </Panel>
      </div>
    </div>
  )
}
