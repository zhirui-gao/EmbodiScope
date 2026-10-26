import { useRef, useState } from 'react'
import type { DatasetEntry } from '@app/store'
import { useStore } from '@app/store'
import { useL } from '@app/i18n'
import { jointDims, setRobot, updateRobotMap, useRobot } from '@app/robotModel'

/** Load a URDF for joint-space datasets and edit the joint mapping. */
export function RobotPanel({ entry }: { entry: DatasetEntry }) {
  const L = useL()
  const robot = useRobot(entry)
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const notify = useStore((s) => s.notify)
  const dims = jointDims(entry)
  const mapped = robot ? Object.values(robot.map).filter(Boolean).length : 0
  return (
    <div className="row wrap small" style={{ gap: 6 }}>
      <button className="small" onClick={() => input.current?.click()} title={L('Load a URDF to render the robot from joint angles (forward kinematics)', '加载 URDF，用关节角做正运动学渲染机器人')}>
        🤖 {robot ? robot.model.name : L('Load URDF', '加载 URDF')}
      </button>
      {!robot && (
        <>
          <input className="small" style={{ width: 260 }} placeholder={L('… or URDF URL (e.g. raw.githubusercontent.com/…)', '… 或 URDF 链接（如 raw.githubusercontent.com/…）')} value={url} onChange={(e) => setUrl(e.target.value)} />
          <button
            className="small"
            disabled={!url}
            onClick={async () => {
              try {
                const r = await fetch(url)
                if (!r.ok) throw new Error(`HTTP ${r.status}`)
                setRobot(entry, url.split('/').pop() || 'robot.urdf', await r.text())
                setOpen(true)
              } catch (err) {
                notify(String((err as Error).message), 'error')
              }
            }}
          >
            {L('Load', '加载')}
          </button>
        </>
      )}
      {robot && (
        <>
          <span className="muted tiny">
            {mapped}/{robot.model.movable.length} {L('joints mapped', '个关节已匹配')}
          </span>
          <button className="small ghost" onClick={() => setOpen((v) => !v)}>
            {open ? '▾' : '▸'} {L('mapping', '关节映射')}
          </button>
          <button className="small ghost" onClick={() => setRobot(entry, null)}>
            ✕
          </button>
        </>
      )}
      <input
        ref={input}
        type="file"
        accept=".urdf,.xml"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          try {
            setRobot(entry, f.name, await f.text())
            setOpen(true)
          } catch (err) {
            notify(String((err as Error).message), 'error')
          }
        }}
      />
      {robot && open && (
        <div className="panel" style={{ width: '100%', maxHeight: 260, overflow: 'auto', padding: 6 }}>
          <div className="faint tiny" style={{ marginBottom: 4 }}>
            {L(
              'Matched by name first, then in depth-first order. Meshes are not loaded: links are drawn between joint origins.',
              '先按名称匹配，其余按 URDF 深度优先顺序依次匹配。不加载网格，连杆以关节原点之间的线段表示。',
            )}
          </div>
          <table className="t">
            <tbody>
              {robot.model.movable.map((j) => (
                <tr key={j.name}>
                  <td className="mono tiny">{j.name}</td>
                  <td className="tiny muted">{j.type}</td>
                  <td>
                    <select className="seg-select" value={robot.map[j.name] ?? ''} onChange={(e) => updateRobotMap(entry, j.name, e.target.value || null)}>
                      <option value="">— (0)</option>
                      {dims.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} · {d.feature}[{d.dim}]
                        </option>
                      ))}
                    </select>
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
