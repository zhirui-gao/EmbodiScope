import { useState } from 'react'
import type { DatasetEntry } from '@app/store'
import { useStore } from '@app/store'
import { useL } from '@app/i18n'
import { playback, useFrame } from '@app/playback'
import type { FrameTable } from '@core/data/frameTable'
import type { SubtaskSegment } from '@core/analysis/summary'
import { metadataSubtasks } from '@core/analysis/summary'
import { heuristicSegments } from '@core/analysis/segmentation'
import { term } from '@app/terms'

/**
 * Manual subtask annotation. Segments are always contiguous and cover [0, T): editing works on boundaries
 * (split at the playhead, merge with the previous segment, move a start to the playhead).
 */
export function AnnotationEditor({ entry, episode, table }: { entry: DatasetEntry; episode: number; table: FrameTable }) {
  const L = useL()
  const lang = useStore((s) => s.lang)
  const ann = useStore((s) => s.annotations[entry.id]?.[episode])
  const setAnnotation = useStore((s) => s.setAnnotation)
  const frame = useFrame(100)
  const [open, setOpen] = useState(false)
  const T = table.length
  const segs = ann?.segments ?? []

  const save = (next: SubtaskSegment[], caption = ann?.caption) => {
    const fixed = next
      .map((s) => ({ ...s, source: s.source === 'llm' ? 'llm+edit' : s.source }))
      .sort((a, b) => a.start - b.start)
      .filter((s) => s.end > s.start)
    setAnnotation(entry.id, episode, {
      ...(ann ?? {}),
      segments: fixed,
      caption,
      model: ann?.model ? (ann.model.endsWith('(edited)') ? ann.model : `${ann.model} (edited)`) : 'manual',
      updatedAt: Date.now(),
    })
  }
  const seed = (from: SubtaskSegment[]) =>
    save(from.length ? from.map((s) => ({ ...s, text: term(lang, s.text), source: 'manual' })) : [{ start: 0, end: T, text: '', source: 'manual' }])
  const at = segs.findIndex((s) => frame >= s.start && frame < s.end)
  const split = () => {
    if (at < 0 || frame <= segs[at].start) return
    const s = segs[at]
    save([...segs.slice(0, at), { ...s, end: frame }, { ...s, start: frame, text: '', skill: undefined, caption: undefined, source: 'manual' }, ...segs.slice(at + 1)])
  }
  const mergePrev = (i: number) => {
    if (i <= 0) return
    const next = [...segs]
    next[i - 1] = { ...next[i - 1], end: next[i].end }
    next.splice(i, 1)
    save(next)
  }
  const moveStart = (i: number) => {
    if (i <= 0 || frame <= segs[i - 1].start || frame >= segs[i].end) return
    const next = [...segs]
    next[i - 1] = { ...next[i - 1], end: frame }
    next[i] = { ...next[i], start: frame }
    save(next)
  }
  const edit = (i: number, patch: Partial<SubtaskSegment>) => save(segs.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  return (
    <div style={{ marginTop: 6 }}>
      <div className="row small">
        <button className="small ghost" onClick={() => setOpen((v) => !v)}>
          {open ? '▾' : '▸'} {L('Annotation editor', '标注编辑')} {segs.length ? `(${segs.length})` : ''}
        </button>
        {open && !segs.length && (
          <>
            <button className="small" onClick={() => seed([])}>
              {L('Start empty', '从空白开始')}
            </button>
            <button className="small" onClick={() => seed(metadataSubtasks(entry.ds, episode))} disabled={!metadataSubtasks(entry.ds, episode).length}>
              {L('Copy metadata subtasks', '复制元数据子任务')}
            </button>
            <button className="small" onClick={() => seed(heuristicSegments(table, entry.sem, entry.ds.fps || 30))}>
              {L('Start from auto segments', '从自动分段开始')}
            </button>
          </>
        )}
        {open && segs.length > 0 && (
          <>
            <button className="small" onClick={split} title={L('Split the segment under the playhead', '在播放头处拆分当前片段')}>
              ✂ {L('Split at frame', '在当前帧拆分')} {frame}
            </button>
            <button className="small ghost" onClick={() => setAnnotation(entry.id, episode, null)}>
              {L('Clear', '清空')}
            </button>
          </>
        )}
      </div>
      {open && segs.length > 0 && (
        <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 4 }}>
          <input
            className="small"
            style={{ width: '100%', marginBottom: 4 }}
            placeholder={L('Episode caption …', '整段描述 …')}
            defaultValue={ann?.caption ?? ''}
            key={`cap-${episode}-${ann?.updatedAt}`}
            onBlur={(e) => e.target.value !== (ann?.caption ?? '') && save(segs, e.target.value)}
          />
          <table className="t">
            <tbody>
              {segs.map((s, i) => (
                <tr key={`${i}-${s.start}`} style={i === at ? { background: '#17243a' } : undefined}>
                  <td className="mono tiny nowrap">
                    <a style={{ cursor: 'pointer' }} onClick={() => playback.seek(s.start)}>
                      [{s.start}–{s.end})
                    </a>
                  </td>
                  <td style={{ width: '55%' }}>
                    <input className="small" style={{ width: '100%' }} defaultValue={s.text} key={`t-${s.start}-${s.text}`} placeholder={L('subtask …', '子任务 …')} onBlur={(e) => e.target.value !== s.text && edit(i, { text: e.target.value })} />
                  </td>
                  <td>
                    <input className="small" style={{ width: 90 }} defaultValue={s.skill ?? ''} key={`s-${s.start}-${s.skill}`} placeholder={L('skill', '技能')} onBlur={(e) => e.target.value !== (s.skill ?? '') && edit(i, { skill: e.target.value || undefined })} />
                  </td>
                  <td className="nowrap">
                    <button className="small ghost" disabled={i === 0} onClick={() => moveStart(i)} title={L('Move this start to the playhead', '把起点移到播放头')}>
                      ⇤ {L('start here', '起点设为当前帧')}
                    </button>
                    <button className="small ghost" disabled={i === 0} onClick={() => mergePrev(i)} title={L('Merge with previous', '与上一段合并')}>
                      ⤒
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
