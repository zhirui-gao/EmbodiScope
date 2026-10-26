import { useEffect, useState } from 'react'
import { currentEntry, useStore } from './store'
import type { Tab } from './store'
import { useL } from './i18n'
import { TopBar } from '@ui/TopBar'
import { Sidebar } from '@ui/Sidebar'
import { Welcome } from '@ui/Welcome'
import { OverviewView } from '@ui/views/OverviewView'
import { EpisodeView } from '@ui/views/EpisodeView'
import { SchemaView } from '@ui/views/SchemaView'
import { QualityView } from '@ui/views/QualityView'
import { CompareView } from '@ui/views/CompareView'
import { AiView } from '@ui/views/AiView'
import { ErrorBoundary } from '@ui/common'
import { GuideView } from '@ui/views/GuideView'
import { sourceFromDrop } from '@core/io/browserSources'
import { HfHubSource, ServerSource } from '@core/io/httpSource'
import { openSource } from './actions'

let autoConnected = false

export function App() {
  const L = useL()
  const tab = useStore((s) => s.tab)
  const entry = useStore(currentEntry)
  const hasData = useStore((s) => Object.keys(s.datasets).length > 0 || s.sources.length > 0)
  const toast = useStore((s) => s.toast)
  const busy = useStore((s) => s.busy)
  const set = useStore((s) => s.set)
  const [collapsed, setCollapsed] = useState(false)

  // served by scripts/serve.mjs (or ?server=http://host:port): connect to its data automatically
  useEffect(() => {
    if (autoConnected) return
    autoConnected = true
    const param = new URLSearchParams(location.search).get('server')
    const hf = new URLSearchParams(location.search).get('hf')
    const base = param ?? (location.protocol.startsWith('http') ? location.href.replace(/[?#].*$/, '').replace(/\/[^/]*$/, '') : null)
    if (base)
      ServerSource.open(base)
        .then((src) => openSource(src))
        .catch(() => param && useStore.getState().notify(`Cannot reach EmbodiScope server ${param}`, 'error'))
    if (hf) HfHubSource.open(hf).then((src) => openSource(src)).catch((e) => useStore.getState().notify(String(e.message), 'error'))
  }, [])

  // drop a folder anywhere
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault()
    const drop = async (e: DragEvent) => {
      e.preventDefault()
      if (!e.dataTransfer) return
      const src = await sourceFromDrop(e.dataTransfer)
      if (src) openSource(src)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  const tabs: [Tab, string][] = [
    ['overview', L('Overview', '数据概览')],
    ['episode', L('Episode viewer', '片段可视化')],
    ['schema', L('Schema & frames', '语义结构/坐标系')],
    ['quality', L('Quality', '质量检测')],
    ['compare', L('Compare', '数据集对比')],
    ['ai', L('AI lab', 'AI 标注')],
    ['guide', L('Guide', '使用说明')],
  ]
  const free = (t: Tab) => t === 'compare' || t === 'ai' || t === 'guide'

  return (
    <div className="app">
      <TopBar onToggleSidebar={() => setCollapsed((c) => !c)} />
      {!hasData && tab === 'guide' ? (
        <GuideView onClose={() => set({ tab: 'overview' })} />
      ) : !hasData ? (
        <div className="view">
          <Welcome />
        </div>
      ) : (
        <div className={`main ${collapsed ? 'collapsed' : ''}`}>
          <Sidebar />
          <div className="content">
            <div className="tabs">
              {tabs.map(([id, label]) => (
                <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => set({ tab: id })} disabled={!entry && !free(id)}>
                  {label}
                </button>
              ))}
            </div>
            {tab === 'guide' ? (
              <GuideView />
            ) : entry || free(tab) ? (
              <ErrorBoundary resetKey={`${tab}:${entry?.id}`}>
                {tab === 'overview' && entry && <OverviewView entry={entry} />}
                {tab === 'episode' && entry && <EpisodeView entry={entry} />}
                {tab === 'schema' && entry && <SchemaView entry={entry} />}
                {tab === 'quality' && entry && <QualityView entry={entry} />}
                {tab === 'compare' && <CompareView />}
                {tab === 'ai' && <AiView entry={entry} />}
              </ErrorBoundary>
            ) : (
              <div className="view muted">{L('Loading datasets …', '正在加载数据集 …')}</div>
            )}
          </div>
        </div>
      )}
      {busy && (
        <div className="busy">
          <div className="spinner" /> {busy}
        </div>
      )}
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  )
}
