import { asyncBufferFromUrl } from 'hyparquet'
import type { FileSource } from './source'
import { cachedBuffer, joinPath } from './source'

/**
 * Generic static HTTP(S) source. Cannot list directories, so loaders resolve files through
 * the path templates in meta/info.json. Requires the server to allow CORS and Range requests.
 */
export class HttpSource implements FileSource {
  readonly kind: FileSource['kind'] = 'http'
  readonly label: string
  protected sizes = new Map<string, number>()
  protected files: string[] | null = null

  constructor(
    readonly baseUrl: string,
    label?: string,
    readonly headers: Record<string, string> = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.label = label ?? this.baseUrl
  }

  fileUrl(path: string) {
    return `${this.baseUrl}/${joinPath(path).split('/').map(encodeURIComponent).join('/')}`
  }
  async listing() {
    return this.files
  }
  async exists(path: string) {
    if (this.files) return this.files.includes(path)
    try {
      const r = await fetch(this.fileUrl(path), { method: 'HEAD', headers: this.headers })
      return r.ok
    } catch {
      return false
    }
  }
  async size(path: string) {
    const known = this.sizes.get(path)
    if (known !== undefined) return known
    const r = await fetch(this.fileUrl(path), { method: 'HEAD', headers: this.headers })
    const n = Number(r.headers.get('content-length') ?? 0)
    this.sizes.set(path, n)
    return n
  }
  async readText(path: string) {
    const r = await fetch(this.fileUrl(path), { headers: this.headers })
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`)
    return r.text()
  }
  async readBytes(path: string) {
    const r = await fetch(this.fileUrl(path), { headers: this.headers })
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`)
    return r.arrayBuffer()
  }
  async asyncBuffer(path: string) {
    const byteLength = this.sizes.get(path)
    return cachedBuffer(await asyncBufferFromUrl({ url: this.fileUrl(path), byteLength, requestInit: { headers: this.headers } }))
  }
  async url(path: string) {
    return this.fileUrl(path)
  }
  async transferable(path: string) {
    return this.fileUrl(path)
  }
}

/** A folder exported by `scripts/serve.mjs` (or the dev server): listing from /api/list, bytes from /files/. */
export class ServerSource extends HttpSource {
  static async open(baseUrl: string): Promise<ServerSource> {
    const base = baseUrl.replace(/\/+$/, '')
    const r = await fetch(`${base}/api/list`)
    if (!r.ok) throw new Error(`EmbodiScope server ${r.status}`)
    const j = (await r.json()) as { roots: string[]; files: { path: string; size: number }[] }
    const src = new ServerSource(`${base}/files`, j.roots.length === 1 ? j.roots[0] : `server (${j.roots.join(', ')})`)
    src.files = j.files.map((f) => f.path)
    for (const f of j.files) src.sizes.set(f.path, f.size)
    return src
  }
}

/** Hugging Face Hub dataset repo (public, or private with a user token). Listing comes from the Hub API. */
export class HfHubSource extends HttpSource {
  readonly kind = 'hf' as const
  constructor(
    readonly repoId: string,
    readonly revision = 'main',
    token?: string,
  ) {
    super(`https://huggingface.co/datasets/${repoId}/resolve/${encodeURIComponent(revision)}`, `hf://${repoId}`, token ? { Authorization: `Bearer ${token}` } : {})
  }

  static async open(repoId: string, revision = 'main', token?: string): Promise<HfHubSource> {
    const src = new HfHubSource(repoId.trim().replace(/^https?:\/\/huggingface\.co\/datasets\//, '').replace(/\/+$/, ''), revision, token)
    await src.loadTree()
    return src
  }

  private async loadTree() {
    const files: string[] = []
    let url: string | null = `https://huggingface.co/api/datasets/${this.repoId}/tree/${encodeURIComponent(this.revision)}?recursive=true&expand=false`
    while (url) {
      const r: Response = await fetch(url, { headers: this.headers })
      if (!r.ok) throw new Error(`Hugging Face API ${r.status}: ${await r.text()}`)
      const items = (await r.json()) as { type: string; path: string; size?: number; lfs?: { size: number } }[]
      for (const it of items) {
        if (it.type !== 'file') continue
        files.push(it.path)
        this.sizes.set(it.path, it.lfs?.size ?? it.size ?? 0)
      }
      const link = r.headers.get('link')
      const m = link?.match(/<([^>]+)>;\s*rel="next"/)
      url = m ? m[1] : null
    }
    this.files = files
  }
}
