import type { LeRobotDataset } from '@core/lerobot/types'
import { schemaSignature } from './overrides'

/** Minimal promise wrapper over one IndexedDB object store (scan results can be several MB). */
const DB = 'embodiscope'
const STORE = 'kv'

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open()
    return await new Promise((res, rej) => {
      const q = db.transaction(STORE).objectStore(STORE).get(key)
      q.onsuccess = () => res(q.result as T)
      q.onerror = () => rej(q.error)
    })
  } catch {
    return undefined
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((res, rej) => {
      const t = db.transaction(STORE, 'readwrite')
      t.objectStore(STORE).put(value, key)
      t.oncomplete = () => res()
      t.onerror = () => rej(t.error)
    })
  } catch {
    // private mode / quota: caching is best-effort
  }
}

/** Invalidates automatically when the schema, episode count or frame count changes. */
export function scanCacheKey(ds: LeRobotDataset): string {
  const frames = ds.episodes.reduce((a, e) => a + e.length, 0)
  const avail = ds.episodes.filter((e) => e.available).length
  return `scan:v3:${ds.id}:${schemaSignature(ds)}:${ds.episodes.length}:${avail}:${frames}`
}
