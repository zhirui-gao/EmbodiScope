import { useState } from 'react'
import { useStore } from '@app/store'
import { useL } from '@app/i18n'
import { RemoteDialog, useOpenFolder } from './OpenControls'

export function TopBar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const L = useL()
  const lang = useStore((s) => s.lang)
  const tab = useStore((s) => s.tab)
  const set = useStore((s) => s.set)
  const hasData = useStore((s) => s.sources.length > 0)
  const { open, element } = useOpenFolder()
  const [remote, setRemote] = useState(false)
  return (
    <div className="topbar">
      {hasData && (
        <button className="ghost" onClick={onToggleSidebar} title={L('Toggle sidebar', '折叠侧栏')}>
          ☰
        </button>
      )}
      <div className="logo">
        <div className="logo-mark" />
        EmbodiScope <small>{L('embodied data inspector', '具身数据检测平台')}</small>
      </div>
      <span className="spacer" />
      <button onClick={open}>📂 {L('Open folder', '打开本地文件夹')}</button>
      <button onClick={() => setRemote(true)}>🤗 {L('Hugging Face / URL', 'Hugging Face / URL')}</button>
      <button className={tab === 'guide' ? '' : 'ghost'} onClick={() => set({ tab: tab === 'guide' ? 'overview' : 'guide' })}>
        📖 {L('Guide', '使用说明')}
      </button>
      <button className="ghost" onClick={() => set({ lang: lang === 'zh' ? 'en' : 'zh' })} title={L('Interface language', '界面语言')}>
        {lang === 'zh' ? 'EN' : '中文'}
      </button>
      {element}
      {remote && <RemoteDialog onClose={() => setRemote(false)} />}
    </div>
  )
}
