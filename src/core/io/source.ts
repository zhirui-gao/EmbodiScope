import type { AsyncBuffer } from 'hyparquet'

/**
 * A read-only virtual file tree. Every data access in the platform goes through this
 * interface, so datasets can live on a local disk (File System Access API / <input webkitdirectory>),
 * on the Hugging Face Hub, on a plain HTTP server, or on Node's fs (tests / CLI).
 *
 * Paths are always relative, '/'-separated, without a leading slash.
 */
export interface FileSource {
  readonly kind: 'fs-handle' | 'file-list' | 'http' | 'hf' | 'node' | 'memory'
  /** Human-readable label (folder name, repo id, URL). */
  readonly label: string
  /**
   * Full listing of files when the backend can enumerate them (local, HF Hub).
   * `null` for backends that cannot list (plain HTTP) — loaders must then rely on path templates.
   */
  listing(): Promise<string[] | null>
  exists(path: string): Promise<boolean>
  size(path: string): Promise<number>
  readText(path: string): Promise<string>
  readBytes(path: string): Promise<ArrayBuffer>
  /** Random-access buffer used by the parquet reader (only reads the byte ranges it needs). */
  asyncBuffer(path: string): Promise<AsyncBuffer>
  /** URL usable as <video src>. Object URLs are cached and owned by the source. */
  url(path: string): Promise<string>
  /** Something that can be posted to a Web Worker to re-open the file there. */
  transferable(path: string): Promise<File | string>
}

export const SKIP_DIRS = new Set(['.git', '.cache', 'node_modules', '__pycache__', '.huggingface', '.ipynb_checkpoints'])

export function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => p !== '' && p !== '.')
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\//, '')
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? path : path.slice(i + 1)
}

/** AsyncBuffer over a Blob/File: reads byte ranges lazily via Blob.slice. */
export function asyncBufferFromBlob(blob: Blob): AsyncBuffer {
  return {
    byteLength: blob.size,
    slice: (start: number, end?: number) => blob.slice(start, end ?? blob.size).arrayBuffer(),
  }
}

/** Wraps an AsyncBuffer with a small cache for repeated metadata reads (footer etc.). */
export function cachedBuffer(buf: AsyncBuffer): AsyncBuffer {
  const cache = new Map<string, Promise<ArrayBuffer>>()
  return {
    byteLength: buf.byteLength,
    slice(start: number, end?: number) {
      const key = `${start}:${end ?? ''}`
      let hit = cache.get(key)
      if (!hit) {
        hit = Promise.resolve(buf.slice(start, end))
        cache.set(key, hit)
        if (cache.size > 64) cache.delete(cache.keys().next().value as string)
      }
      return hit
    },
  }
}

/** View of a sub-directory of another source. Used to give every discovered dataset its own root. */
export class SubSource implements FileSource {
  readonly kind
  readonly label: string
  constructor(
    readonly parent: FileSource,
    readonly prefix: string,
  ) {
    this.kind = parent.kind
    this.label = prefix ? `${parent.label}/${prefix}` : parent.label
  }
  private p(path: string) {
    return this.prefix ? joinPath(this.prefix, path) : path
  }
  async listing() {
    const all = await this.parent.listing()
    if (!all) return null
    if (!this.prefix) return all
    const pre = this.prefix + '/'
    return all.filter((f) => f.startsWith(pre)).map((f) => f.slice(pre.length))
  }
  exists(path: string) {
    return this.parent.exists(this.p(path))
  }
  size(path: string) {
    return this.parent.size(this.p(path))
  }
  readText(path: string) {
    return this.parent.readText(this.p(path))
  }
  readBytes(path: string) {
    return this.parent.readBytes(this.p(path))
  }
  asyncBuffer(path: string) {
    return this.parent.asyncBuffer(this.p(path))
  }
  url(path: string) {
    return this.parent.url(this.p(path))
  }
  transferable(path: string) {
    return this.parent.transferable(this.p(path))
  }
}

/** Base for sources backed by an in-memory map of path -> lazily resolved File. */
export abstract class FileMapSource implements FileSource {
  abstract readonly kind: FileSource['kind']
  abstract readonly label: string
  protected urls = new Map<string, string>()
  protected abstract files: Map<string, () => Promise<File>>

  async listing() {
    return [...this.files.keys()]
  }
  async exists(path: string) {
    return this.files.has(path)
  }
  protected async file(path: string): Promise<File> {
    const get = this.files.get(path)
    if (!get) throw new Error(`File not found: ${path}`)
    return get()
  }
  async size(path: string) {
    return (await this.file(path)).size
  }
  async readText(path: string) {
    return (await this.file(path)).text()
  }
  async readBytes(path: string) {
    return (await this.file(path)).arrayBuffer()
  }
  async asyncBuffer(path: string) {
    return asyncBufferFromBlob(await this.file(path))
  }
  async url(path: string) {
    let u = this.urls.get(path)
    if (!u) {
      u = URL.createObjectURL(await this.file(path))
      this.urls.set(path, u)
    }
    return u
  }
  async transferable(path: string) {
    return this.file(path)
  }
  dispose() {
    for (const u of this.urls.values()) URL.revokeObjectURL(u)
    this.urls.clear()
  }
}
