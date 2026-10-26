import { useEffect, useState } from 'react'
import { useStore } from '@app/store'
import type { Flag } from '@app/store'
import { useL } from '@app/i18n'

export function FlagBar({ datasetId, episode }: { datasetId: string; episode: number }) {
  const L = useL()
  const current = useStore((s) => s.flags[datasetId]?.[episode])
  const setFlags = useStore((s) => s.setFlags)
  const [note, setNote] = useState(current?.note ?? '')
  useEffect(() => setNote(current?.note ?? ''), [episode, current?.note])
  const toggle = (f: Flag) => setFlags(datasetId, [episode], current?.flag === f ? null : { flag: f, note: note || undefined })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return
      const f = ({ g: 'keep', b: 'exclude', r: 'review' } as Record<string, Flag>)[e.key.toLowerCase()]
      if (f) toggle(f)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const btn = (f: Flag, icon: string, label: string, key: string) => (
    <button className={`small ${current?.flag === f ? 'primary' : ''}`} onClick={() => toggle(f)} title={`${label} (${key})`}>
      <span className={current?.flag === f ? '' : `flag-${f}`}>{icon}</span> {label}
    </button>
  )
  return (
    <div className="row" style={{ gap: 4 }}>
      {btn('keep', '✓', L('Keep', '保留'), 'G')}
      {btn('exclude', '✗', L('Exclude', '剔除'), 'B')}
      {btn('review', '?', L('Review', '待复查'), 'R')}
      {current && (
        <input
          className="small"
          style={{ width: 150 }}
          placeholder={L('note …', '备注 …')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (current.note ?? '') && setFlags(datasetId, [episode], { flag: current.flag, note })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      )}
    </div>
  )
}
