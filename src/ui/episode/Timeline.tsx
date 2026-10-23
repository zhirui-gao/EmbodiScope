import { useEffect, useRef, useState } from 'react'
import { playback, useFrame, usePlaying } from '@app/playback'
import { useL } from '@app/i18n'
import type { TimelineTrack } from './tracks'

export function Transport({ length, fps }: { length: number; fps: number }) {
  const L = useL()
  const frame = useFrame(40)
  const playing = usePlaying()
  const [rate, setRate] = useState(playback.rate)
  return (
    <div className="transport panel">
      <button className="small" onClick={() => playback.step(-1)} title="←">
        ⏮
      </button>
      <button className="small primary" onClick={() => playback.toggle()} title="Space" style={{ width: 44 }}>
        {playing ? '⏸' : '▶'}
      </button>
      <button className="small" onClick={() => playback.step(1)} title="→">
        ⏭
      </button>
      <input type="range" min={0} max={Math.max(0, length - 1)} value={frame} onChange={(e) => playback.seek(Number(e.target.value))} />
      <span className="mono small nowrap" style={{ minWidth: 150, textAlign: 'right' }}>
        {frame} / {length - 1} · {(frame / fps).toFixed(2)} s
      </span>
      <select
        className="small"
        value={rate}
        onChange={(e) => {
          const r = Number(e.target.value)
          setRate(r)
          playback.setRate(r)
        }}
        title={L('playback speed', '播放速度')}
      >
        {[0.25, 0.5, 1, 1.5, 2, 4].map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>
    </div>
  )
}

export function Timeline({ tracks, length }: { tracks: TimelineTrack[]; length: number }) {
  const L = useL()
  const area = useRef<HTMLDivElement>(null)
  const cursor = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<string | null>(null)
  useEffect(() => {
    const upd = (f: number) => {
      if (cursor.current) cursor.current.style.left = `${(f / Math.max(1, length - 1)) * 100}%`
    }
    upd(playback.frame)
    return playback.subscribe(upd)
  }, [length])
  const seekFromEvent = (e: React.MouseEvent) => {
    const r = area.current!.getBoundingClientRect()
    playback.seek(((e.clientX - r.left) / r.width) * (length - 1))
  }
  if (!tracks.length) return <div className="muted small">{L('No subtask / label tracks in this dataset.', '该数据集没有子任务 / 标签轨道。')}</div>
  return (
    <div className="timeline">
      <div className="row" style={{ alignItems: 'stretch' }}>
        <div className="col" style={{ gap: 2, paddingTop: 2 }}>
          {tracks.map((t) => (
            <div key={t.id} className="track-label" style={{ height: 20, lineHeight: '20px' }} title={t.label}>
              {t.label}
            </div>
          ))}
        </div>
        <div
          ref={area}
          className="grow"
          style={{ position: 'relative' }}
          onMouseDown={(e) => {
            seekFromEvent(e)
            const move = (ev: MouseEvent) => seekFromEvent(ev as unknown as React.MouseEvent)
            const up = () => {
              window.removeEventListener('mousemove', move)
              window.removeEventListener('mouseup', up)
            }
            window.addEventListener('mousemove', move)
            window.addEventListener('mouseup', up)
          }}
        >
          {tracks.map((t) => (
            <div key={t.id} className="track">
              {t.segs.map((s, i) => (
                <div
                  key={i}
                  className="seg"
                  style={{ left: `${(s.start / length) * 100}%`, width: `${((s.end - s.start) / length) * 100}%`, background: s.color }}
                  onMouseEnter={() => setHover(`${t.label}: [${s.start}–${s.end}) ${s.text}${s.detail ? ' — ' + s.detail : ''}`)}
                  onMouseLeave={() => setHover(null)}
                  onDoubleClick={() => playback.seek(s.start)}
                >
                  {s.text}
                </div>
              ))}
            </div>
          ))}
          <div ref={cursor} className="cursor-line" />
        </div>
      </div>
      <div className="tiny muted" style={{ minHeight: 16, marginTop: 2 }}>
        {hover ?? L('Click / drag to seek · double-click a segment to jump to its start', '点击/拖动定位 · 双击片段跳到起点')}
      </div>
    </div>
  )
}

/** Text of the segment under the cursor for every subtask-like track. */
export function useCurrentSegments(tracks: TimelineTrack[]) {
  const frame = useFrame(100)
  return tracks
    .filter((t) => t.kind === 'subtask' || t.kind === 'llm' || (t.kind === 'label' && /subtask/.test(t.id)))
    .map((t) => ({ track: t.label, seg: t.segs.find((s) => frame >= s.start && frame < s.end) }))
    .filter((x) => x.seg)
}
