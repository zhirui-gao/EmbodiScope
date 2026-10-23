import type { AsyncBuffer, FileMetaData } from 'hyparquet'
import { parquetMetadataAsync, parquetRead, parquetSchema } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'

export interface ParquetColumnInfo {
  name: string
  /** physical type of the leaf (FLOAT, DOUBLE, INT64, BYTE_ARRAY …) */
  type: string
  /** list / fixed-size list column */
  nested: boolean
  logical?: string
}

export interface ParquetFileInfo {
  numRows: number
  columns: ParquetColumnInfo[]
  metadata: FileMetaData
}

const metaCache = new WeakMap<AsyncBuffer, Promise<FileMetaData>>()

export function parquetMeta(file: AsyncBuffer): Promise<FileMetaData> {
  let p = metaCache.get(file)
  if (!p) {
    p = parquetMetadataAsync(file)
    metaCache.set(file, p)
  }
  return p
}

export async function parquetInfo(file: AsyncBuffer): Promise<ParquetFileInfo> {
  const metadata = await parquetMeta(file)
  const schema = parquetSchema(metadata)
  const leaf = (s: any): any => (s.children.length ? leaf(s.children[0]) : s.element)
  const columns = schema.children.map((c: any) => {
    const l = leaf(c)
    return {
      name: c.element.name as string,
      type: String(l.type ?? 'GROUP'),
      nested: c.children.length > 0,
      logical: l.logical_type?.type ?? l.converted_type,
    }
  })
  return { numRows: Number(metadata.num_rows), columns, metadata }
}

export type RawColumn = any[] | ArrayLike<any>

/**
 * Read a set of columns over [rowStart, rowEnd) in columnar form.
 * Returned arrays have exactly rowEnd - rowStart entries.
 */
export async function readColumns(
  file: AsyncBuffer,
  opts: { columns?: string[]; rowStart?: number; rowEnd?: number } = {},
): Promise<{ numRows: number; columns: Record<string, RawColumn> }> {
  const metadata = await parquetMeta(file)
  const total = Number(metadata.num_rows)
  const rowStart = Math.max(0, opts.rowStart ?? 0)
  const rowEnd = Math.min(total, opts.rowEnd ?? total)
  const n = Math.max(0, rowEnd - rowStart)
  const out: Record<string, any[]> = {}
  if (n === 0) return { numRows: 0, columns: out }
  await parquetRead({
    file,
    metadata,
    columns: opts.columns,
    rowStart,
    rowEnd,
    compressors,
    onChunk(chunk) {
      let arr = out[chunk.columnName]
      if (!arr) arr = out[chunk.columnName] = new Array(n)
      const data = chunk.columnData as ArrayLike<any>
      const from = Math.max(chunk.rowStart, rowStart)
      const to = Math.min(chunk.rowEnd, rowEnd)
      for (let r = from; r < to; r++) arr[r - rowStart] = data[r - chunk.rowStart]
    },
  })
  return { numRows: n, columns: out }
}

/** Read whole file as row objects (small metadata tables only). */
export async function readRows(file: AsyncBuffer, columns?: string[]): Promise<Record<string, any>[]> {
  const { numRows, columns: cols } = await readColumns(file, { columns })
  const keys = Object.keys(cols)
  const rows: Record<string, any>[] = new Array(numRows)
  for (let i = 0; i < numRows; i++) {
    const r: Record<string, any> = {}
    for (const k of keys) r[k] = cols[k][i]
    rows[i] = r
  }
  return rows
}

export function toNumber(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v == null) return NaN
  const n = Number(v)
  return n
}
