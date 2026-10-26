import type { DatasetEntry, EpisodeFlag } from './store'
import { download } from './actions'

export type EpisodeFilter = 'all' | 'keep' | 'exclude' | 'review' | 'unflagged' | 'issues'

export function filterEpisodes(entry: DatasetEntry, flags: Record<number, EpisodeFlag> | undefined, filter: EpisodeFilter, issueEps: Set<number>) {
  return entry.ds.episodes.filter((e) => {
    const f = flags?.[e.index]?.flag
    switch (filter) {
      case 'all':
        return true
      case 'unflagged':
        return !f
      case 'issues':
        return issueEps.has(e.index)
      default:
        return f === filter
    }
  })
}

/**
 * Curation outputs consumed by training pipelines:
 *   episodes_exclude.json — indices to drop (explicit "exclude"),
 *   episodes_keep.json    — every available episode not excluded,
 *   episode_flags.json    — full record with notes and the QA issues touching each episode.
 */
export function exportCuration(entry: DatasetEntry, flags: Record<number, EpisodeFlag> | undefined, what: 'keep' | 'exclude' | 'flags') {
  const name = entry.ds.name.replace(/[^\w.-]+/g, '_')
  const excluded = new Set(Object.entries(flags ?? {}).filter(([, f]) => f.flag === 'exclude').map(([k]) => Number(k)))
  if (what === 'exclude') return download(`${name}_episodes_exclude.json`, JSON.stringify([...excluded].sort((a, b) => a - b)))
  if (what === 'keep')
    return download(`${name}_episodes_keep.json`, JSON.stringify(entry.ds.episodes.filter((e) => e.available && !excluded.has(e.index)).map((e) => e.index)))
  const issuesByEp = new Map<number, string[]>()
  for (const i of entry.issues) for (const ep of i.episodes ?? []) issuesByEp.set(ep, [...(issuesByEp.get(ep) ?? []), i.title.en])
  const eps = new Set([...Object.keys(flags ?? {}).map(Number), ...issuesByEp.keys()])
  const rows = [...eps]
    .sort((a, b) => a - b)
    .map((ep) => ({ episode_index: ep, flag: flags?.[ep]?.flag ?? null, note: flags?.[ep]?.note ?? null, issues: issuesByEp.get(ep) ?? [] }))
  download(`${name}_episode_flags.json`, JSON.stringify({ dataset: entry.ds.name, source: entry.ds.source.label, exported_at: new Date().toISOString(), episodes: rows }, null, 1))
}
