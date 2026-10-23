/** In-place iterative radix-2 FFT (re, im have power-of-two length). */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k]
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ar + br
        im[i + k] = ai + bi
        re[i + k + len / 2] = ar - br
        im[i + k + len / 2] = ai - bi
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

/**
 * Accumulate the power spectrum of a detrended, Hann-windowed signal into `acc` (length n/2).
 * Returns false when the signal is too short or constant.
 */
export function addPowerSpectrum(x: ArrayLike<number>, acc: Float64Array): boolean {
  const n = acc.length * 2
  const T = Math.min(x.length, n)
  if (T < 16) return false
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  // remove linear trend so slow drifts do not dominate
  const a = x[0], b = x[T - 1]
  let any = false
  for (let t = 0; t < T; t++) {
    const v = x[t] - (a + ((b - a) * t) / (T - 1))
    if (!Number.isFinite(v)) return false
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / (T - 1))
    re[t] = v * w
    if (v !== 0) any = true
  }
  if (!any) return false
  fft(re, im)
  for (let k = 1; k < acc.length; k++) acc[k] += re[k] * re[k] + im[k] * im[k]
  return true
}

/** Frequency (Hz) below which `q` of the spectral energy lies. */
export function energyQuantileHz(power: Float64Array, fps: number, q = 0.9): number {
  let total = 0
  for (let k = 1; k < power.length; k++) total += power[k]
  if (!(total > 0)) return NaN
  let c = 0
  for (let k = 1; k < power.length; k++) {
    c += power[k]
    if (c >= q * total) return (k * fps) / (power.length * 2)
  }
  return fps / 2
}

export function nextPow2(n: number) {
  let p = 1
  while (p < n) p <<= 1
  return p
}
