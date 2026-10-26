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
      <div className="seg-toggle" title={L('Language of the whole interface', '整个界面的语言')}>
        <button className={lang === 'zh' ? 'on' : ''} onClick={() => set({ lang: 'zh' })}>
          中文
        </button>
        <button className={lang === 'en' ? 'on' : ''} onClick={() => set({ lang: 'en' })}>
          EN
        </button>
      </div>
      {element}
      {remote && <RemoteDialog onClose={() => setRemote(false)} />}
    </div>
  )
}
