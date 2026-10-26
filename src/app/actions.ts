import type { FileSource } from '@core/io/source'
import { discoverDatasets, loadDataset } from '@core/lerobot/loader'
import { inferSemantics } from '@core/semantics/infer'
import { datasetCard } from '@core/analysis/summary'
import { runChecks } from '@core/analysis/qa'
import type { DatasetEntry, SourceEntry } from './store'
import { restoreAnnotations, useStore } from './store'
import { loadUserOverrides } from './overrides'
import { restoreScan } from './scan'

let sourceCounter = 0

/** Register a source, discover every LeRobot dataset in it and load their metadata (parallel, bounded). */
export async function openSource(source: FileSource) {
  const st = useStore.getState()
  // re-opening the same folder / repo / server replaces the previous entry instead of duplicating it
  const dup = st.sources.find((s) => s.label === source.label && s.source.kind === source.kind)
  if (dup) {
    const ids = new Set(dup.datasets.map((d) => d.id).filter(Boolean))
    useStore.setState((s) => ({
      sources: s.sources.filter((x) => x !== dup),
      datasets: Object.fromEntries(Object.entries(s.datasets).filter(([id]) => !ids.has(id))),
      currentId: s.currentId && ids.has(s.currentId) ? null : s.currentId,
    }))
  }
  st.set({ busy: `Scanning ${source.label} …` })
  try {
    const found = await discoverDatasets(source)
    if (!found.length) {
      st.notify(
        st.lang === 'zh' ? `在 ${source.label} 中没有找到 LeRobot 数据集（需要 meta/info.json）` : `No LeRobot dataset (meta/info.json) found in ${source.label}`,
        'error',
      )
      return
    }
    const entry: SourceEntry = {
      id: `src${++sourceCounter}`,
      source,
      label: source.label,
      datasets: found.map((f) => ({ ...f, status: 'pending' as const })),
    }
    useStore.setState((s) => ({ sources: [...s.sources, entry] }))
    let firstReady: string | null = null
    const queue = [...found.keys()]
    const worker = async () => {
      for (;;) {
        const i = queue.shift()
        if (i === undefined) return
        const f = found[i]
        setStatus(entry.id, i, { status: 'loading' })
        try {
          const ds = await loadDataset(source, f.root)
          const d = buildEntry(ds)
          useStore.setState((s) => ({ datasets: { ...s.datasets, [d.id]: d } }))
          restoreAnnotations(d.id)
          restoreScan(d.id)
          setStatus(entry.id, i, { status: 'ready', id: d.id })
          if (!firstReady) {
            firstReady = d.id
            // select the first dataset but never pull the user away from the page they are on
            if (!useStore.getState().currentId) useStore.getState().set({ currentId: d.id, episodeIndex: null })
          }
        } catch (e) {
          console.error(e)
          setStatus(entry.id, i, { status: 'error', error: (e as Error).message })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, found.length) }, worker))
    st.notify(st.lang === 'zh' ? `已加载 ${found.length} 个数据集` : `Loaded ${found.length} dataset(s)`)
  } catch (e) {
    console.error(e)
    st.notify(String((e as Error).message ?? e), 'error')
  } finally {
    useStore.getState().set({ busy: null })
  }
}

function setStatus(sourceId: string, i: number, patch: Partial<SourceEntry['datasets'][number]>) {
  useStore.setState((s) => ({
    sources: s.sources.map((src) => (src.id === sourceId ? { ...src, datasets: src.datasets.map((d, j) => (j === i ? { ...d, ...patch } : d)) } : src)),
  }))
}

export function buildEntry(ds: DatasetEntry['ds']): DatasetEntry {
  const sem = inferSemantics(ds)
  loadUserOverrides(ds, sem)
  return { id: ds.id, ds, sem, card: datasetCard(ds, sem), issues: runChecks({ ds, sem }), version: 0 }
}

/** Recompute derived data after semantics were edited in place. */
export function refreshDerived(id: string) {
  useStore.getState().updateDataset(id, (d) => ({
    card: datasetCard(d.ds, d.sem),
    issues: runChecks({ ds: d.ds, sem: d.sem, metrics: d.scan?.status === 'done' ? d.scan.metrics : undefined, videos: d.scan?.videos }),
    version: d.version + 1,
  }))
}

export function selectEpisode(index: number) {
  useStore.getState().set({ episodeIndex: index, tab: 'episode' })
}

export function download(name: string, content: string | Blob, mime = 'application/json') {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
