import { FileMapSource, SKIP_DIRS } from './source'

export type ProgressFn = (msg: string, count: number) => void

/** Local folder opened through the File System Access API (Chrome / Edge). Files are resolved lazily. */
export class FsHandleSource extends FileMapSource {
  readonly kind = 'fs-handle' as const
  readonly label: string
  protected files = new Map<string, () => Promise<File>>()

  private constructor(readonly handle: FileSystemDirectoryHandle) {
    super()
    this.label = handle.name
  }

  static async open(handle: FileSystemDirectoryHandle, onProgress?: ProgressFn): Promise<FsHandleSource> {
    const src = new FsHandleSource(handle)
    await src.walk(handle, '', onProgress)
    return src
  }

  private async walk(dir: FileSystemDirectoryHandle, prefix: string, onProgress?: ProgressFn) {
    const subdirs: Promise<void>[] = []
    // `entries()` is not in older lib.dom typings
    for await (const [name, entry] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>) as any) {
      if (entry.kind === 'directory') {
        if (SKIP_DIRS.has(name)) continue
        subdirs.push(this.walk(entry as FileSystemDirectoryHandle, prefix + name + '/', onProgress))
      } else {
        const fh = entry as FileSystemFileHandle
        let cached: Promise<File> | null = null
        this.files.set(prefix + name, () => (cached ??= fh.getFile()))
        if (this.files.size % 500 === 0) onProgress?.(prefix, this.files.size)
      }
    }
    await Promise.all(subdirs)
  }
}

/** Folder selected via <input webkitdirectory> or a drag-and-drop of files (works in every browser). */
export class FileListSource extends FileMapSource {
  readonly kind = 'file-list' as const
  protected files = new Map<string, () => Promise<File>>()

  constructor(
    readonly label: string,
    entries: Iterable<[string, File]>,
  ) {
    super()
    for (const [path, file] of entries) {
      if (path.split('/').some((seg) => SKIP_DIRS.has(seg))) continue
      this.files.set(path, async () => file)
    }
  }

  /** Builds a source from <input webkitdirectory>. The common top folder is stripped from paths. */
  static fromFileList(list: FileList | File[]): FileListSource {
    const arr = Array.from(list)
    const rel = (f: File) => ((f as any).webkitRelativePath as string) || f.name
    const first = arr.length ? rel(arr[0]).split('/')[0] : 'files'
    const allShareTop = arr.every((f) => rel(f).startsWith(first + '/'))
    return new FileListSource(
      first,
      arr.map((f) => [allShareTop ? rel(f).slice(first.length + 1) : rel(f), f] as [string, File]),
    )
  }
}

/** Resolve a drag-and-drop DataTransfer into a source (directory handle when possible, entries API otherwise). */
export async function sourceFromDrop(dt: DataTransfer, onProgress?: ProgressFn): Promise<FsHandleSource | FileListSource | null> {
  const items = Array.from(dt.items).filter((i) => i.kind === 'file')
  if (!items.length) return null
  const first = items[0] as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }
  if (items.length === 1 && first.getAsFileSystemHandle) {
    const h = await first.getAsFileSystemHandle()
    if (h && h.kind === 'directory') return FsHandleSource.open(h as FileSystemDirectoryHandle, onProgress)
  }
  const out: [string, File][] = []
  const readEntry = async (entry: any, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file: File = await new Promise((res, rej) => entry.file(res, rej))
      out.push([prefix + entry.name, file])
    } else if (entry.isDirectory) {
      if (SKIP_DIRS.has(entry.name)) return
      const reader = entry.createReader()
      for (;;) {
        const batch: any[] = await new Promise((res, rej) => reader.readEntries(res, rej))
        if (!batch.length) break
        await Promise.all(batch.map((e) => readEntry(e, prefix + entry.name + '/')))
      }
    }
  }
  const entries = items.map((i) => i.webkitGetAsEntry()).filter(Boolean)
  await Promise.all(entries.map((e) => readEntry(e, '')))
  if (!out.length) return null
  const top = entries.length === 1 && entries[0]!.isDirectory ? entries[0]!.name : 'dropped'
  const strip = top !== 'dropped' ? top.length + 1 : 0
  return new FileListSource(top, out.map(([p, f]) => [p.slice(strip), f]))
}

export const hasDirectoryPicker = () => typeof (window as any).showDirectoryPicker === 'function'

export async function pickDirectory(onProgress?: ProgressFn): Promise<FsHandleSource | null> {
  try {
    const handle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ mode: 'read', id: 'embodiscope' })
    return FsHandleSource.open(handle, onProgress)
  } catch (e: any) {
    if (e?.name === 'AbortError') return null
    throw e
  }
}
