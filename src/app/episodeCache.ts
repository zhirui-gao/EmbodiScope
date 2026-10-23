import { useEffect, useState } from 'react'
import { loadEpisode } from '@core/lerobot/episode'
import type { LoadedEpisode } from '@core/lerobot/episode'
import type { DatasetEntry } from './store'

const cache = new Map<string, Promise<LoadedEpisode>>()
const MAX = 6

export function getEpisode(entry: DatasetEntry, index: number): Promise<LoadedEpisode> {
  const key = `${entry.id}#${index}`
  let p = cache.get(key)
  if (p) {
    cache.delete(key)
    cache.set(key, p)
    return p
  }
  const ep = entry.ds.episodes.find((e) => e.index === index)
  if (!ep) return Promise.reject(new Error(`episode ${index} not found`))
  p = loadEpisode(entry.ds, ep)
  p.catch(() => cache.delete(key))
  cache.set(key, p)
  while (cache.size > MAX) cache.delete(cache.keys().next().value as string)
  return p
}

export function useEpisode(entry: DatasetEntry | undefined, index: number | null) {
  const [state, setState] = useState<{ data?: LoadedEpisode; error?: string; loading: boolean }>({ loading: false })
  useEffect(() => {
    if (!entry || index == null) {
      setState({ loading: false })
      return
    }
    let alive = true
    setState({ loading: true })
    getEpisode(entry, index)
      .then((data) => alive && setState({ data, loading: false }))
      .catch((e) => alive && setState({ error: (e as Error).message, loading: false }))
    return () => {
      alive = false
    }
  }, [entry?.id, index])
  return state
}
