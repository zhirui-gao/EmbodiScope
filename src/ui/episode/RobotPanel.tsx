import { useRef, useState } from 'react'
import type { DatasetEntry } from '@app/store'
import { useStore } from '@app/store'
import { useL } from '@app/i18n'
import { jointDims, setRobot, updateRobotMap, useRobot } from '@app/robotModel'

/** Load a URDF for joint-space datasets and edit the joint mapping. Collapsed to one button unless `expanded`. */
export function RobotPanel({ entry, expanded = false }: { entry: DatasetEntry; expanded?: boolean }) {
  const L = useL()
  const robot = useRobot(entry)
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(expanded && !robot)
  const [mapping, setMapping] = useState(false)
  const [url, setUrl] = useState('')
  const notify = useStore((s) => s.notify)
  const dims = jointDims(entry)
  const mapped = robot ? Object.values(robot.map).filter(Boolean).length : 0
  const load = (name: string, xml: string) => {
    setRobot(entry, name, xml)
    setOpen(false)
    setMapping(true)
  }
  return (
    <div className="col small" style={{ gap: 6 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <button className="small" onClick={() => (robot ? setMapping((v) => !v) : setOpen((v) => !v))} title={L('Robot model from URDF (forward kinematics)', '用 URDF 显示机器人模型（正运动学）')}>
          🤖 {robot ? `${robot.model.name} · ${mapped}/${robot.model.movable.length}` : L('Robot model (URDF)', '机器人模型 (URDF)')}
        </button>
        {robot && (
          <button className="small ghost" onClick={() => setRobot(entry, null)} title={L('Remove', '移除')}>
            ✕
          </button>
        )}
      </div>
      {open && !robot && (
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="small" onClick={() => input.current?.click()}>
            {L('Choose .urdf file', '选择 .urdf 文件')}
          </button>
          <input className="small grow" style={{ minWidth: 180 }} placeholder={L('or paste a URDF URL', '或粘贴 URDF 链接')} value={url} onChange={(e) => setUrl(e.target.value)} />
          <button
            className="small"
            disabled={!url}
            onClick={async () => {
              try {
                const r = await fetch(url)
                if (!r.ok) throw new Error(`HTTP ${r.status}`)
                load(url.split('/').pop() || 'robot.urdf', await r.text())
              } catch (err) {
                notify(String((err as Error).message), 'error')
              }
            }}
          >
            {L('Load', '加载')}
          </button>
        </div>
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
            load(f.name, await f.text())
          } catch (err) {
            notify(String((err as Error).message), 'error')
          }
        }}
      />
      {robot && mapping && (
        <div className="panel" style={{ maxHeight: 220, overflow: 'auto', padding: 6 }}>
          <div className="faint tiny" style={{ marginBottom: 4 }}>
            {L('Joints are matched by name, then in URDF order. Links are drawn between joint origins (no meshes).', '关节先按名称匹配，其余按 URDF 顺序匹配。连杆以关节原点之间的线段表示（不加载网格）。')}
          </div>
          <table className="t">
            <tbody>
              {robot.model.movable.map((j) => (
                <tr key={j.name}>
                  <td className="mono tiny">{j.name}</td>
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
