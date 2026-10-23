import { asyncBufferFromUrl, cachedAsyncBuffer } from 'hyparquet'
import { asyncBufferFromBlob } from '../io/source'
import { readColumns, parquetInfo } from '../data/parquet'
import { FrameTable } from '../data/frameTable'
import type { DatasetSemantics } from '../semantics/types'
import type { FeatureStats } from '../lerobot/types'
import { computeEpisodeMetrics } from './episodeMetrics'
import type { EpisodeMetrics } from './episodeMetrics'

/**
 * One data file and the episodes it contains (1 for v2.x, many for v3.0). The file is decoded once
 * and sliced per episode. Self-contained so it can run in a Web Worker without the FileSource.
 */
export interface ScanJob {
  file: File | string
  size?: number
  episodes: { episode: number; rowStart: number; rowEnd: number }[]
}

export interface ScanConfig {
  fps: number
  stats: Record<string, FeatureStats> | null
  sem: DatasetSemantics
  columns: string[]
}

export function scanColumns(sem: DatasetSemantics): string[] {
  const cols = new Set(['timestamp', 'frame_index'])
  for (const s of sem.segments) {
    if (s.end <= s.start) continue
    if (s.role === 'label' || s.role === 'index' || s.role === 'camera_intrinsics' || s.role === 'camera_distortion' || s.role === 'confidence') continue
    if (s.role === 'body_keypoint') continue
    cols.add(s.feature)
  }
  return [...cols]
}

export async function runScanJob(job: ScanJob, cfg: ScanConfig): Promise<EpisodeMetrics[]> {
  try {
    const buf =
      typeof job.file === 'string' ? cachedAsyncBuffer(await asyncBufferFromUrl({ url: job.file, byteLength: job.size })) : asyncBufferFromBlob(job.file)
    const info = await parquetInfo(buf)
    const available = new Set(info.columns.map((c) => c.name))
    const ranges = job.episodes.map((e) => ({ ...e, rowEnd: e.rowEnd > e.rowStart ? e.rowEnd : info.numRows }))
    const lo = Math.min(...ranges.map((e) => e.rowStart))
    const hi = Math.max(...ranges.map((e) => e.rowEnd))
    const { numRows, columns } = await readColumns(buf, { columns: cfg.columns.filter((c) => available.has(c)), rowStart: lo, rowEnd: hi })
    const table = FrameTable.fromColumns(numRows, columns)
    return ranges.map((e) => computeEpisodeMetrics({ fps: cfg.fps, stats: cfg.stats }, cfg.sem, table.slice(e.rowStart - lo, e.rowEnd - lo), e.episode))
  } catch (e) {
    return job.episodes.map((x) => ({ ...emptyMetrics(x.episode), error: (e as Error).message }))
  }
}

function emptyMetrics(episode: number): EpisodeMetrics {
  return {
    episode, length: 0, duration: 0, dtMean: NaN, dtStd: NaN, maxGapFrames: 0, nonMonotonic: 0, irregularSteps: 0, startTimestamp: 0, frameIndexOk: true,
    nanCount: 0, nanFeatures: [], constantDims: 0, idleHead: 0, idleTail: 0, idleRatio: 0, motion: 0, maxJumpRatio: {}, jerkiness: {}, bandwidth90: {}, pathLength: {},
    quatNormErr: 0, quatSignFlips: 0, eulerWraps: 0, gripperEvents: 0, actionLag: {}, workspace: {},
  }
}
