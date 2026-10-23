/**
 * Minimal PNG decoder for depth maps: browsers decode 16-bit PNGs to 8 bits, which destroys
 * millimetre depth. Supports grayscale / gray+alpha / RGB / RGBA, 8 and 16 bit, non-interlaced.
 */
export interface DecodedPng {
  width: number
  height: number
  channels: number
  bitDepth: number
  /** samples, row-major, channels interleaved */
  data: Uint16Array | Uint8Array
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate')
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function decodePng(bytes: Uint8Array): Promise<DecodedPng> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0) !== 0x89504e47) throw new Error('not a PNG')
  let p = 8
  let width = 0, height = 0, bitDepth = 8, colorType = 0, interlace = 0
  const idat: Uint8Array[] = []
  while (p < bytes.length) {
    const len = view.getUint32(p)
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7])
    const body = bytes.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      const v = new DataView(body.buffer, body.byteOffset, body.byteLength)
      width = v.getUint32(0)
      height = v.getUint32(4)
      bitDepth = body[8]
      colorType = body[9]
      interlace = body[12]
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    p += 12 + len
  }
  if (interlace) throw new Error('interlaced PNG not supported')
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colorType]
  if (!channels || (bitDepth !== 8 && bitDepth !== 16)) throw new Error(`unsupported PNG (color ${colorType}, ${bitDepth} bit)`)
  const all = new Uint8Array(idat.reduce((a, b) => a + b.length, 0))
  let o = 0
  for (const c of idat) all.set(c, o), (o += c.length)
  const raw = await inflate(all)
  const bpp = (channels * bitDepth) / 8
  const stride = width * bpp
  const out = new Uint8Array(height * stride)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = line[x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 255
    }
    prev = cur
  }
  if (bitDepth === 8) return { width, height, channels, bitDepth, data: out }
  const data = new Uint16Array(width * height * channels)
  for (let i = 0; i < data.length; i++) data[i] = (out[2 * i] << 8) | out[2 * i + 1]
  return { width, height, channels, bitDepth, data }
}

/** Turbo colormap (Google, Apache-2.0) polynomial approximation, t in [0, 1]. */
export function turbo(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t))
  const r = 0.13572138 + t * (4.6153926 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))))
  const g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))))
  const b = 0.1066733 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))))
  return [Math.round(255 * Math.max(0, Math.min(1, r))), Math.round(255 * Math.max(0, Math.min(1, g))), Math.round(255 * Math.max(0, Math.min(1, b)))]
}

/** Render a single-channel image with a robust (p2–p98) range into RGBA. Zero = invalid depth = black. */
export function colorizeDepth(img: DecodedPng, range?: [number, number]): { rgba: Uint8ClampedArray; range: [number, number] } {
  const n = img.width * img.height
  const ch = img.channels
  let lo = range?.[0], hi = range?.[1]
  if (lo === undefined || hi === undefined) {
    const sample: number[] = []
    for (let i = 0; i < n; i += 37) {
      const v = img.data[i * ch]
      if (v > 0) sample.push(v)
    }
    sample.sort((a, b) => a - b)
    lo = sample[Math.floor(sample.length * 0.02)] ?? 0
    hi = sample[Math.floor(sample.length * 0.98)] ?? 1
  }
  const span = Math.max(1, hi - lo)
  const rgba = new Uint8ClampedArray(n * 4)
  const lut = Array.from({ length: 256 }, (_, i) => turbo(i / 255))
  for (let i = 0; i < n; i++) {
    const v = img.data[i * ch]
    if (!v) {
      rgba[i * 4 + 3] = 255
      continue
    }
    const c = lut[Math.max(0, Math.min(255, Math.round(((v - lo) / span) * 255)))]
    rgba[i * 4] = c[0]
    rgba[i * 4 + 1] = c[1]
    rgba[i * 4 + 2] = c[2]
    rgba[i * 4 + 3] = 255
  }
  return { rgba, range: [lo, hi] }
}
