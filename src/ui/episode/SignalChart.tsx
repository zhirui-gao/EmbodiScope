import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import { playback } from '@app/playback'
import { useStore } from '@app/store'

export interface ChartSeries {
  label: string
  values: ArrayLike<number>
  color: string
  dash?: boolean
}

/** Fast time-series plot (uPlot). Frame cursor is a DOM overlay so playback never triggers a redraw. */
export function SignalChart({ title, series, length, height = 150, syncKey }: { title: string; series: ChartSeries[]; length: number; height?: number; syncKey: string }) {
  const host = useRef<HTMLDivElement>(null)
  const cursor = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const chunk = useRef<HTMLDivElement>(null)
  // episodes can have dozens of chart groups: only build plots that are (nearly) on screen
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '300px' })
    if (box.current) io.observe(box.current)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    const el = host.current!
    const x = Float64Array.from({ length }, (_, i) => i)
    const data: uPlot.AlignedData = [x, ...series.map((s) => Float64Array.from(s.values as ArrayLike<number>, (v) => (Number.isFinite(v) ? v : (null as unknown as number))))]
    const opts: uPlot.Options = {
      width: el.clientWidth || 400,
      height,
      legend: { show: series.length <= 16, live: true },
      cursor: { sync: { key: syncKey }, drag: { x: true, y: false } },
      scales: { x: { time: false } },
      axes: [
        { stroke: '#8b9ab0', grid: { stroke: '#1d2633' }, ticks: { stroke: '#273243' }, size: 26, font: '10px sans-serif' },
        { stroke: '#8b9ab0', grid: { stroke: '#1d2633' }, ticks: { stroke: '#273243' }, size: 46, font: '10px sans-serif' },
      ],
      series: [{ label: 'frame' }, ...series.map((s) => ({ label: s.label, stroke: s.color, width: 1.25, dash: s.dash ? [5, 4] : undefined, points: { show: false } }))],
      hooks: {
        ready: [
          (u) => {
            u.over.addEventListener('click', () => {
              const v = u.posToVal(u.cursor.left ?? 0, 'x')
              if (Number.isFinite(v)) playback.seek(v)
            })
          },
        ],
      },
    }
    const u = new uPlot(opts, data, el)
    const place = (f: number) => {
      if (!cursor.current) return
      const left = u.valToPos(f, 'x') + u.over.offsetLeft
      cursor.current.style.left = `${left}px`
      cursor.current.style.top = `${u.over.offsetTop}px`
      cursor.current.style.height = `${u.over.clientHeight}px`
      const H = useStore.getState().settings.chunkHorizon
      if (chunk.current) {
        chunk.current.style.display = H ? 'block' : 'none'
        chunk.current.style.left = `${left}px`
        chunk.current.style.top = `${u.over.offsetTop}px`
        chunk.current.style.height = `${u.over.clientHeight}px`
        chunk.current.style.width = `${Math.max(0, u.valToPos(Math.min(length - 1, f + H), 'x') + u.over.offsetLeft - left)}px`
      }
    }
    place(playback.frame)
    const un = playback.subscribe(place)
    const ro = new ResizeObserver(() => {
      u.setSize({ width: el.clientWidth, height })
      place(playback.frame)
    })
    ro.observe(el)
    return () => {
      un()
      ro.disconnect()
      u.destroy()
    }
  }, [series, length, height, syncKey, visible])
  return (
    <div className="chart-box" ref={box}>
      <div className="title">{title}</div>
      <div style={{ position: 'relative', minHeight: visible ? undefined : height + 30 }}>
        <div ref={host} />
        <div ref={chunk} style={{ position: 'absolute', background: '#ffe06622', borderLeft: 'none', pointerEvents: 'none', display: 'none' }} />
        <div ref={cursor} className="cursor-line" style={{ width: 1, background: '#ffffffaa', boxShadow: 'none' }} />
      </div>
    </div>
  )
}
