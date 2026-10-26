import type { FileSource } from '../io/source'
import { SubSource, dirname, joinPath } from '../io/source'
import { readColumns, readRows, toNumber } from '../data/parquet'
import { parquetInfo } from '../data/parquet'
import { formatTemplate, templateToRegex } from './template'
import type {
  DatasetExtras,
  EpisodeInfo,
  FeatureSpec,
  FeatureStats,
  LabelVocabulary,
  LeRobotDataset,
  TaskInfo,
  VideoRef,
} from './types'
import { IMAGE_DTYPES, VIDEO_DTYPES } from './types'

export interface DiscoveredDataset {
  /** root path relative to the source ('' when the source itself is the dataset) */
  root: string
  name: string
}

/** Find every LeRobot dataset (a folder containing meta/info.json) inside a source. */
export async function discoverDatasets(source: FileSource): Promise<DiscoveredDataset[]> {
  const files = await source.listing()
  if (!files) {
    return (await source.exists('meta/info.json')) ? [{ root: '', name: source.label }] : []
  }
  const roots = files
    .filter((f) => f === 'meta/info.json' || f.endsWith('/meta/info.json'))
    .map((f) => dirname(dirname(f)))
  roots.sort()
  return roots.map((root) => ({ root, name: root ? datasetName(root) : source.label }))
}

const GENERIC_DIRS = new Set(['main', 'data', 'dataset', 'datasets', 'lerobot', 'v2.1', 'v3.0', 'v21', 'v30', 'default', 'train', 'snapshots'])

/** Human-friendly name: last path segment, or "parent/last" when the last one is generic (e.g. RoboCoIN ".../main"). */
export function datasetName(root: string): string {
  const parts = root.split('/').filter(Boolean)
  const last = parts[parts.length - 1] ?? root
  return GENERIC_DIRS.has(last.toLowerCase()) && parts.length > 1 ? `${parts[parts.length - 2]}/${last}` : last
}

export function parseJsonl(text: string): any[] {
  const out: any[] = []
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue
    try {
      out.push(JSON.parse(s))
    } catch {
      // tolerate trailing garbage lines
    }
  }
  return out
}

/** Flatten LeRobot "names" (list | {"motors": [...]} | nested lists | null) into per-dim names. */
export function flattenNames(raw: unknown, dim: number): string[] | null {
  if (raw == null) return null
  const out: string[] = []
  const walk = (v: unknown, prefix: string) => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x, prefix)
    } else if (v && typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>)
      // {"motors": [...]} style -> just the list; {"axes": [...], ...} multiple groups -> prefixed
      if (entries.length === 1) walk(entries[0][1], prefix)
      else for (const [k, x] of entries) walk(x, prefix ? `${prefix}.${k}` : k)
    } else if (v != null) {
      out.push(prefix ? `${prefix}.${String(v)}` : String(v))
    }
  }
  walk(raw, '')
  if (!out.length) return null
  if (out.length !== dim) {
    // image-like names ["height","width","channel"] or mismatching lists -> not per-dim names
    return out.length > dim ? out.slice(0, dim) : null
  }
  return out
}

function parseFeatures(info: Record<string, any>): FeatureSpec[] {
  const feats = (info.features ?? {}) as Record<string, any>
  return Object.entries(feats).map(([key, f]) => {
    const dtype = String(f?.dtype ?? 'unknown')
    const shape: number[] = Array.isArray(f?.shape) ? f.shape.map(Number) : []
    const isVideo = VIDEO_DTYPES.has(dtype)
    const isImage = IMAGE_DTYPES.has(dtype)
    const dim = isVideo || isImage ? 0 : shape.reduce((a, b) => a * b, 1) || 1
    return {
      key,
      dtype,
      shape,
      rawNames: f?.names ?? null,
      names: isVideo || isImage ? null : flattenNames(f?.names, dim),
      info: f?.info ?? f?.video_info,
      isVideo,
      isImage,
      dim,
    }
  })
}

function normStats(s: any): FeatureStats | undefined {
  if (!s || typeof s !== 'object') return undefined
  const arr = (v: any): number[] | undefined => {
    if (v == null) return undefined
    const flat: number[] = []
    const walk = (x: any) => (Array.isArray(x) || ArrayBuffer.isView(x) ? Array.from(x as ArrayLike<any>).forEach(walk) : flat.push(toNumber(x)))
    walk(v)
    return flat
  }
  const count = arr(s.count)
  return { min: arr(s.min), max: arr(s.max), mean: arr(s.mean), std: arr(s.std), count: count?.[0], q01: arr(s.q01), q99: arr(s.q99) }
}

function normStatsMap(obj: any): Record<string, FeatureStats> {
  const out: Record<string, FeatureStats> = {}
  for (const [k, v] of Object.entries(obj ?? {})) {
    const s = normStats(v)
    if (s) out[k] = s
  }
  return out
}

async function tryText(src: FileSource, path: string): Promise<string | null> {
  try {
    if (!(await src.exists(path))) return null
    return await src.readText(path)
  } catch {
    return null
  }
}

export interface LoadOptions {
  onProgress?: (msg: string) => void
}

export async function loadDataset(parent: FileSource, root: string, opts: LoadOptions = {}): Promise<LeRobotDataset> {
  const t0 = performance.now()
  const source = root ? new SubSource(parent, root) : parent
  const warnings: string[] = []
  const infoText = await source.readText('meta/info.json')
  const info = JSON.parse(infoText) as Record<string, any>
  const version = String(info.codebase_version ?? 'unknown')
  const features = parseFeatures(info)
  const fps = Number(info.fps ?? 0)
  if (!fps) warnings.push('info.json has no fps')
  const listing = await source.listing()
  const fileSet = listing ? new Set(listing) : null

  opts.onProgress?.('episodes')
  const isV3 = version.startsWith('v3')
  const { episodes, tasks, stats } = isV3
    ? await loadV3(source, info, features, fileSet, warnings)
    : await loadV2(source, info, features, fileSet, warnings)

  const extras = await loadExtras(source, listing)

  const declared = Number(info.total_episodes ?? episodes.length)
  if (declared !== episodes.length) warnings.push(`info.total_episodes=${declared} but ${episodes.length} episodes are listed in metadata`)
  const missing = episodes.filter((e) => !e.available).length
  if (missing) warnings.push(`${missing}/${episodes.length} episodes have no data file in this copy (partial download or sampled subset)`)

  let totalBytes: number | undefined
  if (listing && 'sizes' in (parent as any)) {
    const sizes = (parent as any).sizes as Map<string, number>
    const pre = root ? root + '/' : ''
    totalBytes = 0
    for (const f of listing) totalBytes += sizes.get(pre + f) ?? 0
  }

  return {
    id: `${parent.label}::${root}`,
    name: root ? datasetName(root) : parent.label,
    root,
    source,
    version,
    info,
    fps,
    robotType: String(info.robot_type ?? 'unknown'),
    features,
    tasks,
    episodes,
    stats,
    extras,
    warnings,
    totalBytes,
    loadMs: performance.now() - t0,
  }
}

// ---------------------------------------------------------------- v2.0 / v2.1

async function loadV2(
  source: FileSource,
  info: Record<string, any>,
  features: FeatureSpec[],
  fileSet: Set<string> | null,
  warnings: string[],
) {
  const chunksSize = Number(info.chunks_size ?? 1000)
  const dataTpl = String(info.data_path ?? 'data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet')
  const videoTpl = info.video_path ? String(info.video_path) : null
  const videoKeys = features.filter((f) => f.isVideo).map((f) => f.key)

  const tasksText = await tryText(source, 'meta/tasks.jsonl')
  const tasks: TaskInfo[] = tasksText
    ? parseJsonl(tasksText).map((t, i) => ({ index: Number(t.task_index ?? i), text: String(t.task ?? '') }))
    : []

  let epRows: any[] = []
  const epText = await tryText(source, 'meta/episodes.jsonl')
  if (epText) epRows = parseJsonl(epText)
  else if (fileSet) {
    // reconstruct from data files
    const { re, vars } = templateToRegex(dataTpl)
    const idxVar = vars.indexOf('episode_index')
    for (const f of fileSet) {
      const m = f.match(re)
      if (m && idxVar >= 0) epRows.push({ episode_index: Number(m[idxVar + 1]) })
    }
    epRows.sort((a, b) => a.episode_index - b.episode_index)
    warnings.push('meta/episodes.jsonl missing — episodes reconstructed from data files (lengths unknown until loaded)')
  }

  const epStatsText = await tryText(source, 'meta/episodes_stats.jsonl')
  const epStats = new Map<number, Record<string, FeatureStats>>()
  if (epStatsText) for (const r of parseJsonl(epStatsText)) epStats.set(Number(r.episode_index), normStatsMap(r.stats))

  let stats: Record<string, FeatureStats> | null = null
  const statsText = await tryText(source, 'meta/stats.json')
  if (statsText) stats = normStatsMap(JSON.parse(statsText))
  else if (info.stats) stats = normStatsMap(info.stats)
  else if (epStats.size) stats = aggregateStats([...epStats.values()])

  const STD = new Set(['episode_index', 'tasks', 'length'])
  const episodes: EpisodeInfo[] = epRows.map((r) => {
    const index = Number(r.episode_index)
    const chunk = Math.floor(index / chunksSize)
    const dataPath = formatTemplate(dataTpl, { episode_chunk: chunk, episode_index: index, chunk_index: chunk, file_index: index })
    const videos: Record<string, VideoRef> = {}
    if (videoTpl)
      for (const vk of videoKeys)
        videos[vk] = { path: formatTemplate(videoTpl, { episode_chunk: chunk, episode_index: index, video_key: vk, chunk_index: chunk, file_index: index }), fromTimestamp: 0 }
    const extra: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r)) if (!STD.has(k)) extra[k] = v
    const length = Number(r.length ?? 0)
    return {
      index,
      length,
      tasks: Array.isArray(r.tasks) ? r.tasks.map(String) : r.tasks ? [String(r.tasks)] : [],
      dataPath,
      rowStart: 0,
      rowEnd: length,
      videos,
      extra,
      stats: epStats.get(index),
      available: fileSet ? fileSet.has(dataPath) : true,
    }
  })
  return { episodes, tasks, stats }
}

// ---------------------------------------------------------------- v3.0

async function loadV3(
  source: FileSource,
  info: Record<string, any>,
  features: FeatureSpec[],
  fileSet: Set<string> | null,
  warnings: string[],
) {
  const dataTpl = String(info.data_path ?? 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet')
  const videoTpl = info.video_path ? String(info.video_path) : null
  const videoKeys = features.filter((f) => f.isVideo).map((f) => f.key)

  // tasks.parquet: task string is stored either as a column or as the pandas index
  const tasks: TaskInfo[] = []
  if (!fileSet || fileSet.has('meta/tasks.parquet')) {
    try {
      const rows = await readRows(await source.asyncBuffer('meta/tasks.parquet'))
      rows.forEach((r, i) => {
        const textKey = Object.keys(r).find((k) => k !== 'task_index' && typeof r[k] === 'string')
        tasks.push({ index: Number(r.task_index ?? i), text: textKey ? String(r[textKey]) : '' })
      })
      tasks.sort((a, b) => a.index - b.index)
    } catch (e) {
      warnings.push(`could not read meta/tasks.parquet: ${(e as Error).message}`)
    }
  } else if (fileSet.has('meta/tasks.jsonl')) {
    const t = await source.readText('meta/tasks.jsonl')
    parseJsonl(t).forEach((r, i) => tasks.push({ index: Number(r.task_index ?? i), text: String(r.task ?? '') }))
  }

  // episodes metadata files
  let epFiles: string[] = []
  if (fileSet) epFiles = [...fileSet].filter((f) => /^meta\/episodes\/.*\.parquet$/.test(f)).sort()
  else {
    for (let c = 0; c < 100; c++) {
      let found = false
      for (let f = 0; f < 1000; f++) {
        const p = `meta/episodes/chunk-${String(c).padStart(3, '0')}/file-${String(f).padStart(3, '0')}.parquet`
        if (await source.exists(p)) {
          epFiles.push(p)
          found = true
        } else break
      }
      if (!found) break
    }
  }
  if (!epFiles.length) warnings.push('no meta/episodes/*.parquet found')

  const rows: Record<string, any>[] = []
  const statCols = new Map<string, string[]>() // feature -> stat column names
  for (const f of epFiles) {
    const buf = await source.asyncBuffer(f)
    const pinfo = await parquetInfo(buf)
    const cols = pinfo.columns.map((c) => c.name)
    const base = cols.filter((c) => !c.startsWith('stats/'))
    const sCols = cols.filter((c) => c.startsWith('stats/'))
    for (const c of sCols) {
      const [, feat, stat] = c.match(/^stats\/(.+)\/([^/]+)$/) ?? []
      if (!feat) continue
      if (!statCols.has(feat)) statCols.set(feat, [])
      statCols.get(feat)!.push(stat)
    }
    const { numRows, columns } = await readColumns(buf, { columns: [...base, ...sCols.filter((c) => /\/(min|max|mean|std|count)$/.test(c))] })
    for (let i = 0; i < numRows; i++) {
      const r: Record<string, any> = {}
      for (const k of Object.keys(columns)) r[k] = columns[k][i]
      rows.push(r)
    }
  }
  rows.sort((a, b) => toNumber(a.episode_index) - toNumber(b.episode_index))
  if (rows.length && !('tasks' in rows[0]) && tasks.length)
    warnings.push('meta/episodes has no "tasks" column — instructions are resolved per frame from task_index (filled in when episodes are loaded or scanned)')

  // first global index of each data file -> row offset inside the file
  const fileStart = new Map<string, number>()
  const resolveData = (r: Record<string, any>) =>
    formatTemplate(dataTpl, { chunk_index: toNumber(r['data/chunk_index'] ?? 0), file_index: toNumber(r['data/file_index'] ?? 0) })
  for (const r of rows) {
    const p = resolveData(r)
    const from = toNumber(r.dataset_from_index ?? 0)
    fileStart.set(p, Math.min(fileStart.get(p) ?? Infinity, from))
  }

  const STD = /^(episode_index|tasks|length|dataset_from_index|dataset_to_index|data\/|videos\/|meta\/episodes\/|stats\/)/
  const episodes: EpisodeInfo[] = rows.map((r) => {
    const index = toNumber(r.episode_index)
    const dataPath = resolveData(r)
    const from = toNumber(r.dataset_from_index ?? 0)
    const to = toNumber(r.dataset_to_index ?? from + toNumber(r.length))
    const off = fileStart.get(dataPath) ?? 0
    const videos: Record<string, VideoRef> = {}
    if (videoTpl)
      for (const vk of videoKeys) {
        const ci = r[`videos/${vk}/chunk_index`]
        const fi = r[`videos/${vk}/file_index`]
        if (ci == null || fi == null) continue
        videos[vk] = {
          path: formatTemplate(videoTpl, { video_key: vk, chunk_index: toNumber(ci), file_index: toNumber(fi) }),
          fromTimestamp: toNumber(r[`videos/${vk}/from_timestamp`] ?? 0),
          toTimestamp: r[`videos/${vk}/to_timestamp`] != null ? toNumber(r[`videos/${vk}/to_timestamp`]) : undefined,
        }
      }
    const epStats: Record<string, FeatureStats> = {}
    for (const [feat, statNames] of statCols) {
      const s: any = {}
      for (const st of statNames) if (r[`stats/${feat}/${st}`] != null) s[st] = r[`stats/${feat}/${st}`]
      const n = normStats(s)
      if (n) epStats[feat] = n
    }
    const extra: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r)) if (!STD.test(k)) extra[k] = v
    const tasksRaw = r.tasks
    return {
      index,
      length: toNumber(r.length ?? to - from),
      tasks: Array.isArray(tasksRaw) || ArrayBuffer.isView(tasksRaw) ? Array.from(tasksRaw as ArrayLike<any>).map(String) : tasksRaw ? [String(tasksRaw)] : [],
      dataPath,
      rowStart: from - off,
      rowEnd: to - off,
      videos,
      extra,
      stats: Object.keys(epStats).length ? epStats : undefined,
      available: fileSet ? fileSet.has(dataPath) : true,
    }
  })

  let stats: Record<string, FeatureStats> | null = null
  const statsText = await tryText(source, 'meta/stats.json')
  if (statsText) stats = normStatsMap(JSON.parse(statsText))
  else {
    const per = episodes.map((e) => e.stats).filter(Boolean) as Record<string, FeatureStats>[]
    if (per.length) stats = aggregateStats(per)
  }
  return { episodes, tasks, stats }
}

/** Pool per-episode stats (count-weighted mean / pooled std, global min / max). */
export function aggregateStats(per: Record<string, FeatureStats>[]): Record<string, FeatureStats> {
  const out: Record<string, FeatureStats> = {}
  const keys = new Set(per.flatMap((p) => Object.keys(p)))
  for (const k of keys) {
    const items = per.map((p) => p[k]).filter((s): s is FeatureStats => !!s && !!s.mean)
    if (!items.length) continue
    const d = items[0].mean!.length
    const min = new Array(d).fill(Infinity)
    const max = new Array(d).fill(-Infinity)
    const sum = new Array(d).fill(0)
    const sq = new Array(d).fill(0)
    let n = 0
    for (const s of items) {
      const c = s.count ?? 1
      n += c
      for (let i = 0; i < d; i++) {
        if (s.min) min[i] = Math.min(min[i], s.min[i])
        if (s.max) max[i] = Math.max(max[i], s.max[i])
        const m = s.mean![i]
        const sd = s.std?.[i] ?? 0
        sum[i] += m * c
        sq[i] += (sd * sd + m * m) * c
      }
    }
    const mean = sum.map((v) => v / n)
    out[k] = { min, max, mean, std: sq.map((v, i) => Math.sqrt(Math.max(0, v / n - mean[i] * mean[i]))), count: n }
  }
  return out
}

// ---------------------------------------------------------------- sidecar metadata

export function parseModality(raw: any): DatasetExtras['modality'] {
  const groups = (section: any, defaultKey: string) =>
    Object.entries(section ?? {})
      .map(([name, g]: [string, any]) => ({
        name,
        key: String(g?.original_key ?? defaultKey),
        start: Number(g?.start),
        end: Number(g?.end),
        absolute: typeof g?.absolute === 'boolean' ? g.absolute : undefined,
        rotationType: g?.rotation_type ? String(g.rotation_type) : undefined,
      }))
      .filter((g) => Number.isFinite(g.start) && Number.isFinite(g.end) && g.end > g.start)
      .sort((a, b) => a.start - b.start)
  return { state: groups(raw?.state, 'observation.state'), action: groups(raw?.action, 'action'), raw }
}

const STANDARD_META = new Set([
  'meta/modality.json',
  'meta/info.json',
  'meta/episodes.jsonl',
  'meta/tasks.jsonl',
  'meta/episodes_stats.jsonl',
  'meta/stats.json',
  'meta/tasks.parquet',
])

async function loadExtras(source: FileSource, listing: string[] | null): Promise<DatasetExtras> {
  const extras: DatasetExtras = { vocabularies: [], documents: [], sidecarFiles: [] }
  const modalityText = await tryText(source, 'meta/modality.json')
  if (modalityText) {
    try {
      extras.modality = parseModality(JSON.parse(modalityText))
      extras.documents.push({ path: 'meta/modality.json', text: modalityText })
    } catch {
      // malformed modality.json is shown as a warning-free omission
    }
  }
  if (!listing) return extras
  for (const f of listing) {
    if (/^(data|videos|images)\//.test(f) || STANDARD_META.has(f) || f.startsWith('meta/episodes/')) continue
    extras.sidecarFiles.push(f)
  }
  for (const f of extras.sidecarFiles) {
    const lower = f.toLowerCase()
    try {
      if (lower.endsWith('.jsonl') && (lower.startsWith('annotations/') || lower.startsWith('meta/'))) {
        const vocab = parseVocabulary(f, await source.readText(f))
        if (vocab) extras.vocabularies.push(vocab)
        else if ((await source.size(f)) < 256_000) extras.documents.push({ path: f, text: await source.readText(f) })
      } else if (/\.(json|ya?ml|md|txt)$/.test(lower) && !lower.startsWith('.')) {
        if ((await source.size(f)) < 256_000) extras.documents.push({ path: f, text: await source.readText(f) })
      }
    } catch {
      // unreadable sidecar files are ignored
    }
  }
  return extras
}

/** Lines like {"subtask_index": 0, "subtask": "Grasp the red block"} -> vocabulary "subtask". */
export function parseVocabulary(path: string, text: string): LabelVocabulary | null {
  const rows = parseJsonl(text)
  if (!rows.length) return null
  const keys = Object.keys(rows[0])
  const idxKey = keys.find((k) => k.endsWith('_index') && typeof rows[0][k] === 'number')
  if (!idxKey) return null
  const name = idxKey.slice(0, -'_index'.length)
  const textKey = keys.find((k) => k !== idxKey && typeof rows[0][k] === 'string') ?? name
  if (!rows.every((r) => typeof r[idxKey] === 'number' && typeof r[textKey] === 'string')) return null
  const labels = new Map<number, string>()
  for (const r of rows) labels.set(r[idxKey], r[textKey])
  return { name, file: path, labels }
}

export { joinPath }
