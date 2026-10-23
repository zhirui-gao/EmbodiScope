import { useEffect, useRef, useState } from 'react'
import type { DatasetEntry } from '@app/store'
import type { EpisodeInfo } from '@core/lerobot/types'
import type { CameraModel } from '@core/semantics/types'
import { loadBinaryColumn } from '@core/lerobot/episode'
import { colorizeDepth, decodePng } from '@core/video/png'
import { playback } from '@app/playback'
import { useL } from '@app/i18n'

/**
 * Per-frame images stored inside parquet (LeRobot `image` features, e.g. RoboMIND 16-bit depth PNGs).
 * Loaded on demand because the column can be hundreds of MB.
 */
export function ImageTile({ entry, ep, cam }: { entry: DatasetEntry; ep: EpisodeInfo; cam: CameraModel }) {
  const L = useL()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [frames, setFrames] = useState<(Uint8Array | null)[] | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [info, setInfo] = useState('')
  useEffect(() => {
    setFrames(null)
    setState('idle')
    setInfo('')
  }, [ep.index, cam.key])

  useEffect(() => {
    if (!frames) return
    let busy = false
    let pending: number | null = null
    let range: [number, number] | undefined
    const draw = async (f: number) => {
      if (busy) {
        pending = f
        return
      }
      busy = true
      try {
        const bytes = frames[Math.min(f, frames.length - 1)]
        const cv = canvas.current
        if (bytes && cv) {
          const ctx = cv.getContext('2d')!
          const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
          const png = isPng ? await decodePng(bytes) : null
          if (png && (png.channels === 1 || cam.isDepth)) {
            const { rgba, range: r } = colorizeDepth(png, range)
            range = r
            cv.width = png.width
            cv.height = png.height
            const img = ctx.createImageData(png.width, png.height)
            img.data.set(rgba)
            ctx.putImageData(img, 0, 0)
            setInfo(`${png.bitDepth}-bit · ${r[0]}–${r[1]}${png.bitDepth === 16 ? ' (mm?)' : ''}`)
          } else {
            const bmp = await createImageBitmap(new Blob([bytes as BlobPart]))
            cv.width = bmp.width
            cv.height = bmp.height
            ctx.drawImage(bmp, 0, 0)
          }
        }
      } catch (e) {
        setInfo(String((e as Error).message))
      } finally {
        busy = false
        if (pending !== null) {
          const p = pending
          pending = null
          draw(p)
        }
      }
    }
    draw(playback.frame)
    return playback.subscribe(draw)
  }, [frames, cam.isDepth])

  const load = async () => {
    setState('loading')
    try {
      setFrames(await loadBinaryColumn(entry.ds, ep, cam.key, 0, ep.length || 1_000_000))
      setState('idle')
    } catch (e) {
      setState('error')
      setInfo((e as Error).message)
    }
  }

  return (
    <div className="video-tile" style={cam.width && cam.height ? { aspectRatio: `${cam.width} / ${cam.height}` } : undefined}>
      <canvas ref={canvas} style={{ width: '100%', height: '100%', objectFit: 'contain', display: frames ? 'block' : 'none' }} />
      <div className="label">
        {cam.name} {info && <span className="faint">· {info}</span>}
      </div>
      {!frames && (
        <div className="err" style={{ color: 'var(--muted)', flexDirection: 'column', gap: 8 }}>
          <div>{cam.isDepth ? L('Depth stored in parquet', '深度图存储在 parquet 中') : L('Images stored in parquet', '图像存储在 parquet 中')}</div>
          <button className="small" onClick={load} disabled={state === 'loading'}>
            {state === 'loading' ? L('Loading …', '加载中 …') : L('Load frames', '加载图像')}
          </button>
          {state === 'error' && <div style={{ color: 'var(--err)' }}>{info}</div>}
        </div>
      )}
    </div>
  )
}
