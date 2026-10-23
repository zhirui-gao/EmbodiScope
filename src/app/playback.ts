import { useEffect, useState } from 'react'

interface VideoBinding {
  el: HTMLVideoElement
  /** seconds in the file where frame 0 of the episode is (v3 concatenated videos) */
  offset: number
  ok: boolean
}

type Listener = (frame: number) => void

/**
 * Single clock for an episode. Frame index is the source of truth; videos are slaved to it.
 * While playing, the first healthy video drives the clock (smooth A/V), others are drift-corrected.
 * Without playable videos a wall-clock timer drives playback.
 */
export class Playback {
  frame = 0
  length = 1
  fps = 30
  rate = 1
  loop = true
  playing = false
  private videos: VideoBinding[] = []
  private listeners = new Set<Listener>()
  private stateListeners = new Set<() => void>()
  private raf = 0
  private lastTs = 0
  private acc = 0

  reset(length: number, fps: number) {
    this.pause()
    this.length = Math.max(1, length)
    this.fps = fps || 30
    this.videos = []
    this.seek(0)
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  subscribeState(fn: () => void) {
    this.stateListeners.add(fn)
    return () => void this.stateListeners.delete(fn)
  }
  private emit() {
    for (const l of this.listeners) l(this.frame)
  }
  private emitState() {
    for (const l of this.stateListeners) l()
  }

  bindVideo(el: HTMLVideoElement, offset: number) {
    const b: VideoBinding = { el, offset, ok: true }
    this.videos.push(b)
    el.playbackRate = this.rate
    el.addEventListener('error', () => (b.ok = false))
    const sync = () => {
      el.currentTime = this.videoTime(b)
    }
    if (el.readyState >= 1) sync()
    else el.addEventListener('loadedmetadata', sync, { once: true })
    return () => {
      this.videos = this.videos.filter((v) => v !== b)
    }
  }

  private videoTime(b: VideoBinding) {
    // aim at the middle of the frame to avoid landing on the previous one after rounding
    return b.offset + (this.frame + 0.5) / this.fps
  }

  private master(): VideoBinding | undefined {
    return this.videos.find((v) => v.ok && v.el.readyState >= 2 && !v.el.error)
  }

  seek(frame: number) {
    const f = Math.max(0, Math.min(this.length - 1, Math.round(frame)))
    this.frame = f
    if (!this.playing) for (const v of this.videos) if (v.ok && v.el.readyState >= 1) v.el.currentTime = this.videoTime(v)
    this.emit()
  }

  step(delta: number) {
    this.pause()
    this.seek(this.frame + delta)
  }

  play() {
    if (this.playing) return
    if (this.frame >= this.length - 1) this.seek(0)
    this.playing = true
    for (const v of this.videos) {
      if (!v.ok) continue
      v.el.playbackRate = this.rate
      v.el.currentTime = this.videoTime(v)
      v.el.play().catch(() => (v.ok = false))
    }
    this.lastTs = performance.now()
    this.acc = 0
    this.raf = requestAnimationFrame(this.tick)
    this.emitState()
  }

  pause() {
    if (!this.playing) return
    this.playing = false
    cancelAnimationFrame(this.raf)
    for (const v of this.videos) v.el.pause()
    this.seek(this.frame)
    this.emitState()
  }

  toggle() {
    this.playing ? this.pause() : this.play()
  }

  setRate(r: number) {
    this.rate = r
    for (const v of this.videos) v.el.playbackRate = r
    this.emitState()
  }

  private tick = (ts: number) => {
    if (!this.playing) return
    const m = this.master()
    let f: number
    if (m && !m.el.paused) {
      f = Math.floor((m.el.currentTime - m.offset) * this.fps + 1e-3)
    } else {
      this.acc += ((ts - this.lastTs) / 1000) * this.fps * this.rate
      f = this.frame + Math.floor(this.acc)
      this.acc -= Math.floor(this.acc)
    }
    this.lastTs = ts
    if (f >= this.length - 1) {
      if (this.loop) {
        this.frame = 0
        for (const v of this.videos) if (v.ok) v.el.currentTime = this.videoTime(v)
        this.emit()
      } else {
        this.frame = this.length - 1
        this.emit()
        this.pause()
        return
      }
    } else if (f !== this.frame) {
      this.frame = Math.max(0, f)
      for (const v of this.videos) {
        if (v === m || !v.ok) continue
        const want = this.videoTime(v)
        if (Math.abs(v.el.currentTime - want) > 0.15) v.el.currentTime = want
      }
      this.emit()
    }
    this.raf = requestAnimationFrame(this.tick)
  }
}

export const playback = new Playback()

/** React hook: current frame, throttled for cheap DOM readouts. */
export function useFrame(throttleMs = 50): number {
  const [f, setF] = useState(playback.frame)
  useEffect(() => {
    let last = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const un = playback.subscribe((frame) => {
      const now = performance.now()
      if (now - last >= throttleMs) {
        last = now
        setF(frame)
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null
          last = performance.now()
          setF(playback.frame)
        }, throttleMs)
      }
    })
    return () => {
      un()
      if (timer) clearTimeout(timer)
    }
  }, [throttleMs])
  return f
}

export function usePlaying(): boolean {
  const [p, setP] = useState(playback.playing)
  useEffect(() => playback.subscribeState(() => setP(playback.playing)), [])
  return p
}
