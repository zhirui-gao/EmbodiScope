import { useEffect, useRef, useState } from 'react'
import type { DatasetEntry } from '@app/store'
import { useStore } from '@app/store'
import type { EpisodeInfo } from '@core/lerobot/types'
import type { CameraModel } from '@core/semantics/types'
import { playback } from '@app/playback'
import { useL } from '@app/i18n'
import { browserCanPlay } from '@core/video/mp4'
import type { SceneModel } from '../scene/model'
import { parentOf, projectPoint } from '../scene/model'
import { posAt, rotAt } from '@core/analysis/poses'
import type { Vec3 } from '@core/math/rotation'

const AXIS = ['#ff5c5c', '#4cd964', '#4d8dff']

export function VideoTile({ entry, ep, cam, model }: { entry: DatasetEntry; ep: EpisodeInfo; cam: CameraModel; model: SceneModel | null }) {
  const L = useL()
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const showOverlay = useStore((s) => s.settings.showOverlay)
  const ref = ep.videos[cam.key]

  useEffect(() => {
    let alive = true
    setError(null)
    setSrc(null)
    if (!ref) {
      setError(L('No video file for this episode', '该 episode 没有对应视频文件'))
      return
    }
    entry.ds.source
      .exists(ref.path)
      .then((ok) => {
        if (!ok) throw new Error(L(`Missing file ${ref.path}`, `缺少视频文件 ${ref.path}`))
        return entry.ds.source.url(ref.path)
      })
      .then((u) => alive && setSrc(u))
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [entry.id, ep.index, cam.key])

  useEffect(() => {
    const el = video.current
    if (!el || !src) return
    const unbind = playback.bindVideo(el, ref?.fromTimestamp ?? 0)
    const onErr = () => {
      const codec = cam.codec ?? ''
      const playable = codec ? browserCanPlay(codec) : undefined
      setError(
        playable === false
          ? L(`Codec "${codec}" cannot be decoded by the browser. Re-encode to AV1/H.264 to view.`, `浏览器无法解码 "${codec}" 编码视频，请转码为 AV1/H.264 后查看。`)
          : L('The browser could not decode this video (codec unsupported or file corrupt).', '浏览器无法解码该视频（编码不支持或文件损坏）。'),
      )
    }
    el.addEventListener('error', onErr)
    return () => {
      unbind()
      el.removeEventListener('error', onErr)
    }
  }, [src])

  // projection overlay
  const cameraItem = model?.cameras.find((c) => c.cam.key === cam.key)
  useEffect(() => {
    const cv = canvas.current
    const el = video.current
    if (!cv || !el || !model || !cameraItem || !showOverlay) {
      cv?.getContext('2d')?.clearRect(0, 0, cv.width, cv.height)
      return
    }
    const parent = parentOf(cameraItem.track.segment)
    const poses = model.tracks.filter((t) => parentOf(t.seg) === parent && t.seg.role !== 'base_pose')
    const sk = model.skeleton && model.skeleton.tracks.every((t) => parentOf(t.segment) === parent) ? model.skeleton : null
    const draw = (f: number) => {
      const rect = cv.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      if (cv.width !== Math.round(rect.width * dpr)) {
        cv.width = Math.round(rect.width * dpr)
        cv.height = Math.round(rect.height * dpr)
      }
      const ctx = cv.getContext('2d')!
      ctx.clearRect(0, 0, cv.width, cv.height)
      const vw = el.videoWidth || cam.width || 640
      const vh = el.videoHeight || cam.height || 480
      const scale = Math.min(cv.width / vw, cv.height / vh)
      const ox = (cv.width - vw * scale) / 2
      const oy = (cv.height - vh * scale) / 2
      const camPos = posAt(cameraItem.track, f)
      const camRot = rotAt(cameraItem.track, f)
      let K = cameraItem.K(f)
      if (!camPos || !camRot || !K) return
      // intrinsics given for a different resolution than the decoded video -> rescale by principal point
      const kx = Math.abs(K[2] * 2 - vw) > vw * 0.25 ? vw / (K[2] * 2) : 1
      const ky = Math.abs(K[3] * 2 - vh) > vh * 0.25 ? vh / (K[3] * 2) : 1
      if (kx !== 1 || ky !== 1) K = [K[0] * kx, K[1] * ky, K[2] * kx, K[3] * ky]
      const proj = (p: Vec3) => {
        const r = projectPoint(camPos, camRot, K!, p, cam.convention === 'unknown' ? 'opencv' : cam.convention)
        return r ? ([ox + r[0] * scale, oy + r[1] * scale, r[2]] as const) : null
      }
      ctx.lineWidth = 2.5 * dpr
      ctx.font = `${11 * dpr}px sans-serif`
      for (const t of poses) {
        const p = posAt(t.track, f)
        const R = rotAt(t.track, f)
        if (!p) continue
        const o = proj(p)
        if (!o) continue
        if (R) {
          const len = 0.06
          for (let a = 0; a < 3; a++) {
            const e = proj([p[0] + R[a] * len, p[1] + R[3 + a] * len, p[2] + R[6 + a] * len])
            if (!e) continue
            ctx.strokeStyle = AXIS[a]
            ctx.beginPath()
            ctx.moveTo(o[0], o[1])
            ctx.lineTo(e[0], e[1])
            ctx.stroke()
          }
        }
        ctx.fillStyle = t.color
        ctx.beginPath()
        ctx.arc(o[0], o[1], 4 * dpr, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillText(t.label, o[0] + 6 * dpr, o[1] - 6 * dpr)
      }
      if (sk) {
        ctx.strokeStyle = '#d2a8ffcc'
        ctx.lineWidth = 1.5 * dpr
        for (const [i, j] of sk.bones) {
          const a = posAt(sk.tracks[i], f), b = posAt(sk.tracks[j], f)
          if (!a || !b) continue
          const pa = proj(a), pb = proj(b)
          if (!pa || !pb) continue
          ctx.beginPath()
          ctx.moveTo(pa[0], pa[1])
          ctx.lineTo(pb[0], pb[1])
          ctx.stroke()
        }
      }
    }
    draw(playback.frame)
    const un = playback.subscribe(draw)
    const ro = new ResizeObserver(() => draw(playback.frame))
    ro.observe(cv)
    el.addEventListener('loadedmetadata', () => draw(playback.frame))
    return () => {
      un()
      ro.disconnect()
    }
  }, [model, cameraItem, showOverlay, src])

  return (
    <div className="video-tile" style={cam.width && cam.height ? { aspectRatio: `${cam.width} / ${cam.height}` } : undefined}>
      {src && <video ref={video} src={src} muted playsInline preload="auto" />}
      <canvas ref={canvas} className="overlay" />
      <div className="label">
        {cam.name}
        {cameraItem && showOverlay ? ' · ⊕' : ''}
      </div>
      {error && <div className="err">{error}</div>}
    </div>
  )
}
