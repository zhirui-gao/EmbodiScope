import ScanWorker from '../workers/scan.worker?worker&inline'
import { runScanJob, scanColumns } from '@core/analysis/scanJob'
import type { ScanConfig, ScanJob } from '@core/analysis/scanJob'
import type { EpisodeMetrics } from '@core/analysis/episodeMetrics'
import { runChecks } from '@core/analysis/qa'
import { probeMp4 } from '@core/video/mp4'
import type { VideoProbe } from '@core/video/mp4'
import { useStore } from './store'
import { idbGet, idbSet, scanCacheKey } from './cache'
import { datasetCard } from '@core/analysis/summary'
import type { LeRobotDataset } from '@core/lerobot/types'

const running = new Map<string, { cancelled: boolean }>()

/** v3 episodes without a "tasks" column: take instructions from the scanned per-frame task_index. */
function fillTasks(ds: LeRobotDataset, metrics: EpisodeMetrics[]): boolean {
  const byIndex = new Map(ds.tasks.map((t) => [t.index, t.text]))
  const eps = new Map(ds.episodes.map((e) => [e.index, e]))
  let filled = false
  for (const m of metrics) {
    const e = eps.get(m.episode)
    if (e && !e.tasks.length && m.taskIndices?.length) {
      e.tasks = m.taskIndices.map((i) => byIndex.get(i)).filter((x): x is string => Boolean(x))
      filled = filled || e.tasks.length > 0
    }
  }
  return filled
}

/** Restore a previous full scan of an unchanged dataset (see cache.ts for the invalidation key). */
export async function restoreScan(id: string) {
  const entry = useStore.getState().datasets[id]
  if (!entry) return
  const hit = await idbGet<{ metrics: EpisodeMetrics[]; videos: Record<string, VideoProbe>; ms: number; savedAt: number }>(scanCacheKey(entry.ds))
  if (!hit || useStore.getState().datasets[id]?.scan) return
  const filled = fillTasks(entry.ds, hit.metrics)
  useStore.getState().updateDataset(id, (d) => ({
    ...(filled ? { card: datasetCard(d.ds, d.sem) } : {}),
    scan: { status: 'done', done: hit.metrics.length, total: hit.metrics.length, metrics: hit.metrics, videos: hit.videos, ms: hit.ms, cachedAt: hit.savedAt },
    issues: runChecks({ ds: d.ds, sem: d.sem, metrics: hit.metrics, videos: hit.videos }),
  }))
}

export function cancelScan(id: string) {
  const r = running.get(id)
  if (r) r.cancelled = true
}

/**
 * Full-dataset scan: per-episode metrics in a pool of Web Workers (falls back to the main thread
 * when workers are unavailable, e.g. some file:// setups), then MP4 header probes, then QA checks.
 */
export async function scanDataset(id: string, opts: { maxEpisodes?: number } = {}) {
  const st = useStore.getState()
  const entry = st.datasets[id]
  if (!entry || running.has(id)) return
  const token = { cancelled: false }
  running.set(id, token)
  const { ds, sem } = entry
  const eps = ds.episodes.filter((e) => e.available).slice(0, opts.maxEpisodes ?? Infinity)
  const t0 = performance.now()
  const metrics: EpisodeMetrics[] = []
  const update = (patch: Partial<NonNullable<typeof entry.scan>>) =>
    useStore.getState().updateDataset(id, (d) => ({ scan: { ...(d.scan ?? { status: 'running', done: 0, total: eps.length, metrics: [] }), ...patch } }))
  update({ status: 'running', done: 0, total: eps.length, metrics: [], error: undefined })

  const cfg: ScanConfig = { fps: ds.fps, stats: ds.stats, sem: JSON.parse(JSON.stringify(sem)), columns: scanColumns(sem) }
  // group episodes by data file (v3 files hold many episodes) and split big files so workers share the load
  const byFile = new Map<string, typeof eps>()
  for (const e of eps) {
    if (!byFile.has(e.dataPath)) byFile.set(e.dataPath, [])
    byFile.get(e.dataPath)!.push(e)
  }
  const jobs: ScanJob[] = []
  for (const [path, list] of byFile) {
    const file = await ds.source.transferable(path)
    const size = typeof file === 'string' ? await ds.source.size(path).catch(() => undefined) : undefined
    for (let i = 0; i < list.length; i += 48)
      jobs.push({ file, size, episodes: list.slice(i, i + 48).map((e) => ({ episode: e.index, rowStart: e.rowStart, rowEnd: e.rowEnd })) })
  }

  let lastUi = 0
  const onResult = (ms: EpisodeMetrics[]) => {
    metrics.push(...ms)
    const now = performance.now()
    if (now - lastUi > 150 || metrics.length === eps.length) {
      lastUi = now
      update({ done: metrics.length })
    }
  }

  try {
    const nWorkers = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1, jobs.length))
    let workers: Worker[] = []
    try {
      workers = Array.from({ length: nWorkers }, () => new ScanWorker())
    } catch {
      workers = []
    }
    if (workers.length) {
      for (const w of workers) w.postMessage({ type: 'config', cfg })
      let next = 0
      await Promise.all(
        workers.map(
          (w) =>
            new Promise<void>((resolve) => {
              const pump = () => {
                if (token.cancelled || next >= jobs.length) {
                  w.terminate()
                  resolve()
                  return
                }
                const id = next++
                w.onmessage = (ev) => {
                  onResult(ev.data.result)
                  pump()
                }
                w.onerror = () => {
                  // worker failed (e.g. blocked by CSP): finish this job on the main thread
                  runScanJob(jobs[id], cfg).then((m) => {
                    onResult(m)
                    pump()
                  })
                }
                w.postMessage({ type: 'job', id, job: jobs[id] })
              }
              pump()
            }),
        ),
      )
    } else {
      for (const j of jobs) {
        if (token.cancelled) break
        onResult(await runScanJob(j, cfg))
        await new Promise((r) => setTimeout(r, 0))
      }
    }
    metrics.sort((a, b) => a.episode - b.episode)

    // video headers: one probe per (camera, sampled episode); v3 files are shared so probe each file once
    const videos: Record<string, VideoProbe> = {}
    const seen = new Set<string>()
    const sample = eps.filter((_, i) => i < 10 || i % Math.ceil(eps.length / 20) === 0).slice(0, 30)
    for (const e of sample) {
      if (token.cancelled) break
      for (const [cam, v] of Object.entries(e.videos)) {
        if (seen.has(v.path)) continue
        seen.add(v.path)
        try {
          if (!(await ds.source.exists(v.path))) continue
          const p = await probeMp4(await ds.source.asyncBuffer(v.path))
          videos[`${cam}@${e.index}`] = p
        } catch (err) {
          videos[`${cam}@${e.index}`] = { error: (err as Error).message }
        }
      }
    }
    const status = token.cancelled ? 'cancelled' : 'done'
    const ms = performance.now() - t0
    const filled = fillTasks(ds, metrics)
    update({ status, done: metrics.length, metrics, videos, ms })
    useStore.getState().updateDataset(id, (d) => ({
      ...(filled ? { card: datasetCard(d.ds, d.sem) } : {}),
      issues: runChecks({ ds: d.ds, sem: d.sem, metrics, videos }),
    }))
    if (status === 'done' && !opts.maxEpisodes) idbSet(scanCacheKey(ds), { metrics, videos, ms, savedAt: Date.now() })
  } catch (e) {
    console.error(e)
    update({ status: 'error', error: (e as Error).message, metrics })
  } finally {
    running.delete(id)
  }
}
