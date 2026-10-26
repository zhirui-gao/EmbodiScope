import { useEffect, useMemo, useRef, useState } from 'react'
import guideZh from '../../../docs/guide/guide.zh-CN.md?raw'
import guideEn from '../../../docs/guide/guide.en.md?raw'
import { useStore } from '@app/store'
import { Markdown, parseHeadings } from '../Markdown'

/** Full user guide rendered from docs/guide/*.md (the same files are readable on GitHub). */
export function GuideView({ onClose }: { onClose?: () => void }) {
  const uiLang = useStore((s) => s.lang)
  const [lang, setLang] = useState<'zh' | 'en'>(uiLang)
  const [q, setQ] = useState('')
  const body = useRef<HTMLDivElement>(null)
  const source = lang === 'zh' ? guideZh : guideEn
  const headings = useMemo(() => parseHeadings(source).filter((h) => h.level <= 3), [source])
  const [active, setActive] = useState(headings[0]?.id)

  useEffect(() => {
    const el = body.current
    if (!el) return
    const onScroll = () => {
      const hs = [...el.querySelectorAll('.md-h')] as HTMLElement[]
      const top = el.getBoundingClientRect().top + 40
      let cur = hs[0]?.id
      for (const h of hs) if (h.getBoundingClientRect().top <= top) cur = h.id
      setActive(cur)
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [source])

  const go = (id: string) => body.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const search = (text: string) => {
    setQ(text)
    if (!text) return
    requestAnimationFrame(() => body.current?.querySelector('mark')?.scrollIntoView({ block: 'center' }))
  }
  const zh = lang === 'zh'

  return (
    <div className="guide">
      <aside className="guide-toc">
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="seg-toggle">
            <button className={zh ? 'on' : ''} onClick={() => setLang('zh')}>
              中文
            </button>
            <button className={!zh ? 'on' : ''} onClick={() => setLang('en')}>
              English
            </button>
          </div>
          <span className="spacer" />
          {onClose && (
            <button className="ghost small" onClick={onClose} title={zh ? '关闭' : 'Close'}>
              ✕
            </button>
          )}
        </div>
        <input placeholder={zh ? '搜索说明 …' : 'Search the guide …'} value={q} onChange={(e) => search(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
        {headings.map((h) => (
          <div key={h.id} className={`toc-item l${h.level} ${active === h.id ? 'active' : ''}`} onClick={() => go(h.id)}>
            {h.text}
          </div>
        ))}
      </aside>
      <div className="guide-body" ref={body}>
        <Markdown source={source} highlight={q || undefined} />
      </div>
    </div>
  )
}
