import type { FrameTable } from '@core/data/frameTable'
import type { DatasetSemantics } from '@core/semantics/types'
import { useFrame } from '@app/playback'
import { ROLE_LABEL, useL, useLabel } from '@app/i18n'
import { fmtNum } from '../common'
import { toMatrix, matToQuat } from '@core/math/rotation'

export function FrameInspector({ table, sem, extra }: { table: FrameTable; sem: DatasetSemantics; extra: Record<string, unknown> }) {
  const L = useL()
  const label = useLabel()
  const frame = useFrame(120)
  const segs = sem.segments.filter((s) => s.end > s.start && table.has(s.feature) && s.role !== 'body_keypoint')
  return (
    <div className="grid g2">
      <div style={{ maxHeight: 420, overflow: 'auto' }}>
        <table className="t">
          <thead>
            <tr>
              <th>{L('Signal', '信号')}</th>
              <th>{L('Values at frame', '当前帧数值')} {frame}</th>
            </tr>
          </thead>
          <tbody>
            {segs.map((s) => {
              const v = table.vector(s.feature, frame, s.start, s.end)
              let derived = ''
              if (s.pose?.rot) {
                const q = matToQuat(toMatrix(s.pose.rot.repr, s.pose.rot.idx.map((i) => v[i])))
                derived = `quat(xyzw)=[${q.map((x) => x.toFixed(3)).join(', ')}]`
              }
              return (
                <tr key={s.id}>
                  <td className="nowrap">
                    <div className="mono tiny">{s.id}</div>
                    <div className="tiny muted">
                      {s.stream} · {label(ROLE_LABEL, s.role)} {s.side ?? ''}
                    </div>
                  </td>
                  <td className="mono tiny">
                    {v.map((x, i) => (
                      <span key={i} title={s.names[i]} style={{ marginRight: 8, whiteSpace: 'nowrap' }}>
                        <span className="faint">{(s.names[i] ?? String(i)).replace(/^.*[._](?=[^._]+$)/, '')}=</span>
                        {fmtNum(x, 4)}
                      </span>
                    ))}
                    {derived && <div className="faint">{derived}</div>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div>
        <h4 style={{ marginBottom: 6 }}>{L('Episode metadata', 'Episode 元数据')}</h4>
        <div className="pre">{JSON.stringify(extra, null, 2) || '{}'}</div>
      </div>
    </div>
  )
}
