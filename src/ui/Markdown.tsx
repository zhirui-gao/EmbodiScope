import type { ReactNode } from 'react'
import { Fragment } from 'react'

/**
 * Small, dependency-free Markdown renderer for the in-app guide (headings, paragraphs, lists,
 * tables, code blocks, blockquotes, rules, inline code / bold / italics / links). Produces React
 * elements only — no innerHTML.
 */
export interface Heading {
  id: string
  level: number
  text: string
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`*_[\]()]/g, '')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let k = key
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (m[1]) out.push(<code key={k++}>{t.slice(1, -1)}</code>)
    else if (m[2]) out.push(<b key={k++}>{inline(t.slice(2, -2), k * 100)}</b>)
    else if (m[3]) out.push(<i key={k++}>{inline(t.slice(1, -1), k * 100)}</i>)
    else if (m[4]) {
      const mm = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!
      const href = mm[2]
      out.push(
        <a key={k++} href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noreferrer">
          {inline(mm[1], k * 100)}
        </a>,
      )
    }
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function parseHeadings(md: string): Heading[] {
  const hs: Heading[] = []
  let inCode = false
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('```')) inCode = !inCode
    const m = !inCode && line.match(/^(#{1,3})\s+(.*)$/)
    if (m) hs.push({ level: m[1].length, text: m[2].replace(/[`*]/g, ''), id: slug(m[2]) })
  }
  return hs
}

export function Markdown({ source, highlight }: { source: string; highlight?: string }) {
  const lines = source.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0
  const mark = (nodes: ReactNode[]): ReactNode[] => {
    if (!highlight) return nodes
    const q = highlight.toLowerCase()
    return nodes.map((n, j) => {
      if (typeof n !== 'string') return n
      const idx = n.toLowerCase().indexOf(q)
      if (idx < 0) return n
      return (
        <Fragment key={`h${j}`}>
          {n.slice(0, idx)}
          <mark>{n.slice(idx, idx + q.length)}</mark>
          {n.slice(idx + q.length)}
        </Fragment>
      )
    })
  }
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    if (line.startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++])
      i++
      blocks.push(
        <pre key={key++} className="pre">
          {code.join('\n')}
        </pre>,
      )
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      const Tag = `h${Math.min(4, h[1].length + 1)}` as 'h2'
      blocks.push(
        <Tag key={key++} id={slug(h[2])} className="md-h">
          {mark(inline(h[2]))}
        </Tag>,
      )
      i++
      continue
    }
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={key++} />)
      i++
      continue
    }
    if (line.startsWith('>')) {
      const q: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) q.push(lines[i++].replace(/^>\s?/, ''))
      blocks.push(
        <blockquote key={key++} className="md-quote">
          {mark(inline(q.join(' ')))}
        </blockquote>,
      )
      continue
    }
    if (line.trim().startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells)
        i++
      }
      const [head, ...body] = rows
      blocks.push(
        <table key={key++} className="t md-table">
          <thead>
            <tr>
              {head.map((c, j) => (
                <th key={j}>{mark(inline(c))}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, j) => (
                  <td key={j}>{mark(inline(c))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      )
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')
        i++
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) item += ' ' + lines[i++].trim()
        items.push(item)
      }
      const L = ordered ? 'ol' : 'ul'
      blocks.push(
        <L key={key++} className="md-list">
          {items.map((it, j) => (
            <li key={j}>{mark(inline(it))}</li>
          ))}
        </L>,
      )
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\||\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++])
    blocks.push(
      <p key={key++} className="md-p">
        {mark(inline(para.join(' ')))}
      </p>,
    )
  }
  return <div className="md">{blocks}</div>
}
