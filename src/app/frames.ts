import type { DatasetEntry } from './store'
import type { EpisodeInfo } from '@core/lerobot/types'
import type { FrameSample } from '@core/ai/prompts'

/** Grab JPEG frames from an episode video via an off-screen <video> (works for v2 and v3 concatenated files). */
export async function captureFrames(entry: DatasetEntry, ep: EpisodeInfo, camKey: string, frames: number[], maxSide = 448, quality = 0.78): Promise<FrameSample[]> {
  const ref = ep.videos[camKey]
  if (!ref) throw new Error(`episode ${ep.index} has no video ${camKey}`)
  const url = await entry.ds.source.url(ref.path)
  const fps = entry.ds.fps || 30
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'
  video.src = url
  await new Promise<void>((res, rej) => {
    video.onloadeddata = () => res()
    video.onerror = () => rej(new Error(`cannot decode ${ref.path}`))
  })
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  const ctx = canvas.getContext('2d')!
  const out: FrameSample[] = []
  for (const f of frames) {
    const t = ref.fromTimestamp + (f + 0.5) / fps
    await new Promise<void>((res) => {
      const done = () => {
        video.removeEventListener('seeked', done)
        res()
      }
      video.addEventListener('seeked', done)
      video.currentTime = Math.min(t, (video.duration || t) - 1e-3)
    })
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    out.push({ frame: f, time: f / fps, dataUrl: canvas.toDataURL('image/jpeg', quality), camera: camKey.split('.').pop() ?? camKey })
  }
  video.removeAttribute('src')
  video.load()
  return out
}

export function sampleFrameIndices(length: number, n: number): number[] {
  if (length <= n) return Array.from({ length }, (_, i) => i)
  return Array.from({ length: n }, (_, i) => Math.round((i / (n - 1)) * (length - 1)))
}

/** Pick the camera that best shows the scene for annotation (third-person / head first, wrist last). */
export function defaultAnnotationCamera(entry: DatasetEntry): string | undefined {
  const order = ['third_person', 'head', 'egocentric', 'unknown', 'wrist']
  const cams = entry.sem.cameras.filter((c) => !c.isDepth)
  return [...cams].sort((a, b) => order.indexOf(a.mount) - order.indexOf(b.mount))[0]?.key
}
