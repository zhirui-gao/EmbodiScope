// Shared request handler for `scripts/serve.mjs` and the Vite dev plugin.
// Exposes one or more dataset roots over HTTP:
//   GET /api/list            -> { roots: [...], files: [{ path, size }] }   (paths prefixed by root name)
//   GET /files/<root>/<path>  -> file bytes, supports Range requests (parquet random access, video seeking)
import { createReadStream, promises as fs } from 'node:fs'
import * as path from 'node:path'

const SKIP = new Set(['.git', '.cache', 'node_modules', '__pycache__', '.huggingface'])
const MIME = { '.json': 'application/json', '.jsonl': 'application/json', '.mp4': 'video/mp4', '.parquet': 'application/octet-stream', '.md': 'text/markdown', '.yaml': 'text/yaml', '.yml': 'text/yaml', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }

async function walk(dir, prefix, out) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  await Promise.all(
    entries.map(async (e) => {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) await walk(abs, `${prefix}${e.name}/`, out)
      } else if (e.isFile()) {
        const st = await fs.stat(abs)
        out.push({ path: prefix + e.name, size: st.size })
      }
    }),
  )
}

export function createDataHandler(roots) {
  const named = roots.map((r) => ({ name: path.basename(path.resolve(r)) || 'data', abs: path.resolve(r) }))
  let cache = null
  let cachedAt = 0
  const list = async () => {
    if (cache && Date.now() - cachedAt < 30_000) return cache
    const files = []
    for (const r of named) await walk(r.abs, `${r.name}/`, files)
    cache = { roots: named.map((r) => r.name), files }
    cachedAt = Date.now()
    return cache
  }
  const cors = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Range')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
  }
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x')
    if (!url.pathname.startsWith('/api/list') && !url.pathname.startsWith('/files/')) return false
    cors(res)
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return true
    }
    try {
      if (url.pathname.startsWith('/api/list')) {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(await list()))
        return true
      }
      const rel = decodeURIComponent(url.pathname.slice('/files/'.length))
      const [rootName, ...rest] = rel.split('/')
      const root = named.find((r) => r.name === rootName)
      const abs = root ? path.resolve(root.abs, ...rest) : null
      if (!root || !abs.startsWith(root.abs)) {
        res.statusCode = 404
        res.end('not found')
        return true
      }
      const st = await fs.stat(abs)
      res.setHeader('Accept-Ranges', 'bytes')
      res.setHeader('Content-Type', MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream')
      const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/)
      if (range) {
        let start = range[1] ? Number(range[1]) : st.size - Number(range[2])
        let end = range[1] && range[2] ? Number(range[2]) : st.size - 1
        start = Math.max(0, start)
        end = Math.min(st.size - 1, end)
        res.statusCode = 206
        res.setHeader('Content-Range', `bytes ${start}-${end}/${st.size}`)
        res.setHeader('Content-Length', end - start + 1)
        if (req.method === 'HEAD') return res.end(), true
        createReadStream(abs, { start, end }).pipe(res)
      } else {
        res.setHeader('Content-Length', st.size)
        if (req.method === 'HEAD') return res.end(), true
        createReadStream(abs).pipe(res)
      }
    } catch (e) {
      res.statusCode = 404
      res.end(String(e?.message ?? e))
    }
    return true
  }
}
