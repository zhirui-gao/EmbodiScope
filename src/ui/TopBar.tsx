import { useState } from 'react'
import { useStore } from '@app/store'
import { useL } from '@app/i18n'
import { RemoteDialog, useOpenFolder } from './OpenControls'
import { HelpDialog } from './HelpDialog'

export const REPO_URL = 'https://github.com/embodiscope/embodiscope'

export function TopBar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const L = useL()
  const lang = useStore((s) => s.lang)
  const set = useStore((s) => s.set)
  const hasData = useStore((s) => s.sources.length > 0)
  const { open, element } = useOpenFolder()
  const [remote, setRemote] = useState(false)
  const [help, setHelp] = useState(false)
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
      <button className="ghost" onClick={() => setHelp(true)}>
        {L('Guide', '使用指南')}
      </button>
      <button className="ghost" onClick={() => set({ lang: lang === 'zh' ? 'en' : 'zh' })}>
        {lang === 'zh' ? 'EN' : '中文'}
      </button>
      {element}
      {remote && <RemoteDialog onClose={() => setRemote(false)} />}
      {help && <HelpDialog onClose={() => setHelp(false)} />}
    </div>
  )
}
