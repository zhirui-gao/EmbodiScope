/**
 * Minimal Python str.format() for LeRobot path templates, e.g.
 *   "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet"
 *   "videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4"
 */
export function formatTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)(?::([^}]*))?\}/g, (_m, name: string, spec?: string) => {
    const v = vars[name]
    if (v === undefined) throw new Error(`Template variable "${name}" missing for "${tpl}"`)
    if (!spec) return String(v)
    const m = spec.match(/^(0?)(\d+)d$/)
    if (m && typeof v === 'number') {
      const s = String(Math.trunc(v))
      return m[1] === '0' ? s.padStart(Number(m[2]), '0') : s.padStart(Number(m[2]), ' ')
    }
    return String(v)
  })
}

/** Extract template variables back from a concrete path (used to index files when listings are available). */
export function templateToRegex(tpl: string): { re: RegExp; vars: string[] } {
  const vars: string[] = []
  let src = ''
  let last = 0
  tpl.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)(?::([^}]*))?\}/g, (m, name: string, spec: string | undefined, offset: number) => {
    src += escapeRe(tpl.slice(last, offset))
    vars.push(name)
    src += spec && /d$/.test(spec) ? '(\\d+)' : '([^/]+)'
    last = offset + m.length
    return m
  })
  src += escapeRe(tpl.slice(last))
  return { re: new RegExp('^' + src + '$'), vars }
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
