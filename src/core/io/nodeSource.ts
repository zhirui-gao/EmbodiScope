// Node-only FileSource (tests and the CLI scanner). Never imported by browser code.
import { promises as fs } from 'node:fs'
import * as nodePath from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AsyncBuffer } from 'hyparquet'
import type { FileSource } from './source'
import { SKIP_DIRS } from './source'

export class NodeFsSource implements FileSource {
  readonly kind = 'node' as const
  readonly label: string
  private files: string[] | null = null

  constructor(readonly root: string) {
    this.label = nodePath.basename(root)
  }

  private abs(path: string) {
    return nodePath.join(this.root, ...path.split('/'))
  }

  async listing() {
    if (this.files) return this.files
    const out: string[] = []
    const walk = async (dir: string, prefix: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      await Promise.all(
        entries.map(async (e) => {
          if (e.isDirectory()) {
            if (!SKIP_DIRS.has(e.name)) await walk(nodePath.join(dir, e.name), prefix + e.name + '/')
          } else out.push(prefix + e.name)
        }),
      )
    }
    await walk(this.root, '')
    this.files = out
    return out
  }
  async exists(path: string) {
    try {
      await fs.access(this.abs(path))
      return true
    } catch {
      return false
    }
  }
  async size(path: string) {
    return (await fs.stat(this.abs(path))).size
  }
  readText(path: string) {
    return fs.readFile(this.abs(path), 'utf8')
  }
  async readBytes(path: string) {
    const b = await fs.readFile(this.abs(path))
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  }
  async asyncBuffer(path: string): Promise<AsyncBuffer> {
    const abs = this.abs(path)
    const { size } = await fs.stat(abs)
    return {
      byteLength: size,
      async slice(start: number, end?: number) {
        const fh = await fs.open(abs, 'r')
        try {
          const len = (end ?? size) - start
          const buf = Buffer.alloc(len)
          await fh.read(buf, 0, len, start)
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + len) as ArrayBuffer
        } finally {
          await fh.close()
        }
      },
    }
  }
  async url(path: string) {
    return pathToFileURL(this.abs(path)).href
  }
  async transferable(path: string) {
    return this.abs(path)
  }
}
