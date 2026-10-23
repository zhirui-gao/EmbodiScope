import { FrameTable } from '../data/frameTable'
import { parquetInfo, readColumns } from '../data/parquet'
import type { EpisodeInfo, LeRobotDataset } from './types'

export interface LoadedEpisode {
  info: EpisodeInfo
  table: FrameTable
  /** columns present in the parquet file but not loaded (binary images / depth) */
  deferredColumns: string[]
  loadMs: number
}

export interface EpisodeLoadOptions {
  /** restrict to these columns (plus index columns) */
  columns?: string[]
  /** also load binary columns (embedded images / depth PNGs) */
  includeBinary?: boolean
}

export async function loadEpisode(ds: LeRobotDataset, ep: EpisodeInfo, opts: EpisodeLoadOptions = {}): Promise<LoadedEpisode> {
  const t0 = performance.now()
  const buf = await ds.source.asyncBuffer(ep.dataPath)
  const pinfo = await parquetInfo(buf)
  const binary = new Set(
    pinfo.columns.filter((c) => c.type === 'BYTE_ARRAY' && c.logical !== 'STRING' && c.logical !== 'UTF8').map((c) => c.name),
  )
  for (const f of ds.features) if (f.isImage) binary.add(f.key)
  let columns = pinfo.columns.map((c) => c.name)
  const deferred = opts.includeBinary ? [] : columns.filter((c) => binary.has(c))
  if (!opts.includeBinary) columns = columns.filter((c) => !binary.has(c))
  if (opts.columns) {
    const want = new Set([...opts.columns, 'timestamp', 'frame_index'])
    columns = columns.filter((c) => want.has(c))
  }
  // v2 metadata may lack lengths; v3 rows are a slice of a shared file
  const rowStart = ep.rowStart
  const rowEnd = ep.rowEnd > ep.rowStart ? ep.rowEnd : pinfo.numRows
  const { numRows, columns: cols } = await readColumns(buf, { columns, rowStart, rowEnd })
  const table = FrameTable.fromColumns(numRows, cols)
  if (!ep.length) ep.length = numRows
  return { info: ep, table, deferredColumns: deferred, loadMs: performance.now() - t0 }
}

/** Load binary column values (e.g. depth PNG bytes) for a frame range on demand. */
export async function loadBinaryColumn(ds: LeRobotDataset, ep: EpisodeInfo, column: string, frameStart: number, frameEnd: number) {
  const buf = await ds.source.asyncBuffer(ep.dataPath)
  const { columns } = await readColumns(buf, { columns: [column], rowStart: ep.rowStart + frameStart, rowEnd: ep.rowStart + frameEnd })
  return (columns[column] ?? []) as any[]
}
