import type { AsyncBuffer } from 'hyparquet'

/** Header-level facts about an MP4 file, read without decoding (only the `moov` box is fetched). */
export interface VideoProbe {
  codec?: string
  /** sample entry fourcc (avc1, hvc1, av01, vp09, mp4v …) */
  fourcc?: string
  width?: number
  height?: number
  duration?: number
  frames?: number
  fps?: number
  error?: string
}

const CODEC_BY_FOURCC: Record<string, string> = {
  avc1: 'h264',
  avc3: 'h264',
  hvc1: 'hevc',
  hev1: 'hevc',
  av01: 'av1',
  vp09: 'vp9',
  vp08: 'vp8',
  mp4v: 'mpeg4',
  jpeg: 'mjpeg',
  mjpa: 'mjpeg',
}

const NOT_IN_BROWSERS = new Set(['mpeg4', 'fmp4', 'mp4v', 'xvid', 'divx', 'mjpeg', 'ffv1', 'rawvideo', 'png'])
const MIME: Record<string, string> = {
  h264: 'video/mp4; codecs="avc1.640028"',
  avc1: 'video/mp4; codecs="avc1.640028"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
  h265: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
  av1: 'video/mp4; codecs="av01.0.08M.08"',
  libsvtav1: 'video/mp4; codecs="av01.0.08M.08"',
  libaom_av1: 'video/mp4; codecs="av01.0.08M.08"',
  vp9: 'video/mp4; codecs="vp09.00.10.08"',
}

/** true / false when known, undefined when it cannot be decided (no DOM, unknown codec). */
export function browserCanPlay(codec: string): boolean | undefined {
  const c = codec.toLowerCase().replace(/[^a-z0-9]/g, '')
  const key = c === 'libsvtav1' || c === 'av01' ? 'av1' : c === 'libx264' ? 'h264' : c === 'libx265' ? 'hevc' : c
  if (NOT_IN_BROWSERS.has(key)) return false
  if (typeof document === 'undefined') return undefined
  const mime = MIME[key]
  if (!mime) return undefined
  return document.createElement('video').canPlayType(mime) !== ''
}

interface Box {
  type: string
  start: number
  size: number
  header: number
}

function readBoxes(view: DataView, start: number, end: number): Box[] {
  const out: Box[] = []
  let p = start
  while (p + 8 <= end) {
    let size = view.getUint32(p)
    const type = String.fromCharCode(view.getUint8(p + 4), view.getUint8(p + 5), view.getUint8(p + 6), view.getUint8(p + 7))
    let header = 8
    if (size === 1) {
      size = Number(view.getBigUint64(p + 8))
      header = 16
    } else if (size === 0) size = end - p
    if (size < header) break
    out.push({ type, start: p, size, header })
    p += size
  }
  return out
}

const child = (view: DataView, b: Box, type: string) => readBoxes(view, b.start + b.header, b.start + b.size).find((x) => x.type === type)

async function findMoov(file: AsyncBuffer): Promise<ArrayBuffer | null> {
  let p = 0
  for (let i = 0; i < 64 && p + 8 <= file.byteLength; i++) {
    const h = new DataView(await file.slice(p, Math.min(file.byteLength, p + 16)))
    let size = h.getUint32(0)
    const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7))
    if (size === 1) size = Number(h.getBigUint64(8))
    else if (size === 0) size = file.byteLength - p
    if (type === 'moov') return file.slice(p, p + size)
    if (size < 8) return null
    p += size
  }
  return null
}

export async function probeMp4(file: AsyncBuffer): Promise<VideoProbe> {
  try {
    const moov = await findMoov(file)
    if (!moov) return { error: 'no moov box (not an MP4 / truncated file)' }
    const view = new DataView(moov)
    const root: Box = { type: 'moov', start: 0, size: moov.byteLength, header: 8 }
    for (const trak of readBoxes(view, 8, moov.byteLength).filter((b) => b.type === 'trak')) {
      const mdia = child(view, trak, 'mdia')
      if (!mdia) continue
      const hdlr = child(view, mdia, 'hdlr')
      if (!hdlr) continue
      const handler = String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(hdlr.start + hdlr.header + 8 + i)))
      if (handler !== 'vide') continue
      const out: VideoProbe = {}
      const mdhd = child(view, mdia, 'mdhd')
      let timescale = 0
      if (mdhd) {
        const v = view.getUint8(mdhd.start + mdhd.header)
        const o = mdhd.start + mdhd.header + 4
        if (v === 1) {
          timescale = view.getUint32(o + 16)
          out.duration = Number(view.getBigUint64(o + 20)) / timescale
        } else {
          timescale = view.getUint32(o + 8)
          out.duration = view.getUint32(o + 12) / timescale
        }
      }
      const stbl = (() => {
        const minf = child(view, mdia, 'minf')
        return minf ? child(view, minf, 'stbl') : undefined
      })()
      if (stbl) {
        const stsd = child(view, stbl, 'stsd')
        if (stsd) {
          const entry = stsd.start + stsd.header + 8
          out.fourcc = String.fromCharCode(...[4, 5, 6, 7].map((i) => view.getUint8(entry + i)))
          out.codec = CODEC_BY_FOURCC[out.fourcc] ?? out.fourcc
          out.width = view.getUint16(entry + 32)
          out.height = view.getUint16(entry + 34)
        }
        const stts = child(view, stbl, 'stts')
        if (stts) {
          const n = view.getUint32(stts.start + stts.header + 4)
          let frames = 0
          for (let i = 0; i < n; i++) frames += view.getUint32(stts.start + stts.header + 8 + i * 8)
          out.frames = frames
          if (out.duration) out.fps = frames / out.duration
        }
      }
      void root
      return out
    }
    return { error: 'no video track' }
  } catch (e) {
    return { error: (e as Error).message }
  }
}
