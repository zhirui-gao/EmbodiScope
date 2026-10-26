import type { Tab } from './store'
import { useStore } from './store'
import { playback } from './playback'

/**
 * URL hash ⇄ view state: #ds=<dataset id>&tab=episode&ep=12&f=340.
 * The hash survives reloads; with the data server or HF Hub the link can be shared.
 */
interface Target {
  ds?: string
  tab?: Tab
  ep?: number
  f?: number
}

const TABS: Tab[] = ['overview', 'episode', 'schema', 'quality', 'compare', 'ai', 'guide']

function parse(): Target {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''))
  const tab = h.get('tab') as Tab | null
  return {
    ds: h.get('ds') ?? undefined,
    tab: tab && TABS.includes(tab) ? tab : undefined,
    ep: h.has('ep') ? Number(h.get('ep')) : undefined,
    f: h.has('f') ? Number(h.get('f')) : undefined,
  }
}

let pending: Target | null = null
let pendingFrame: { ds: string; ep: number; f: number } | null = null

function write() {
  const s = useStore.getState()
  const h = new URLSearchParams()
  if (s.currentId) h.set('ds', s.currentId)
  h.set('tab', s.tab)
  if (s.tab === 'episode' && s.episodeIndex != null) {
    h.set('ep', String(s.episodeIndex))
    if (playback.frame > 0) h.set('f', String(playback.frame))
  }
  const next = '#' + h.toString()
  if (next !== location.hash) history.replaceState(null, '', location.pathname + location.search + next)
}

export function initDeepLinks() {
  pending = parse()
  if (!pending.ds) {
    if (pending.tab === 'guide') useStore.getState().set({ tab: 'guide' })
    pending = null
  }
  useStore.subscribe((s, prev) => {
    if (pending?.ds && s.datasets[pending.ds] && !prev.datasets[pending.ds]) {
      const t = pending
      pending = null
      if (t.ep != null && t.f != null) pendingFrame = { ds: t.ds!, ep: t.ep, f: t.f }
      useStore.getState().set({ currentId: t.ds, tab: t.tab ?? 'overview', episodeIndex: t.ep ?? null })
      return
    }
    if (!pending && (s.currentId !== prev.currentId || s.tab !== prev.tab || s.episodeIndex !== prev.episodeIndex)) write()
  })
  playback.subscribeState(() => !playback.playing && write())
  let timer: ReturnType<typeof setTimeout> | null = null
  playback.subscribe(() => {
    if (playback.playing || timer) return
    timer = setTimeout(() => {
      timer = null
      write()
    }, 400)
  })
}

/** Frame requested by a deep link for this episode (consumed once). */
export function takePendingFrame(ds: string, ep: number): number | null {
  if (pendingFrame && pendingFrame.ds === ds && pendingFrame.ep === ep) {
    const f = pendingFrame.f
    pendingFrame = null
    return f
  }
  return null
}
