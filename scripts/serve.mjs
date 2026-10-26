#!/usr/bin/env node
// Serve EmbodiScope + local dataset folders over HTTP (no dependencies).
//
//   node scripts/serve.mjs /path/to/datasets [/another/root ...] [--port 8686] [--host 0.0.0.0]
//
// Open http://localhost:8686 — the app connects to the data automatically. Useful for datasets that
// live on a remote GPU box: run this there and open the page from your laptop (or tunnel the port).
import { createServer } from 'node:http'
import { createReadStream, existsSync, promises as fs } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDataHandler } from './serveCore.mjs'

const args = process.argv.slice(2)
let port = 8686
let host = '127.0.0.1'
const roots = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') port = Number(args[++i])
  else if (args[i] === '--host') host = args[++i]
  else roots.push(args[i])
}
if (!roots.length) {
  console.error('usage: node scripts/serve.mjs <dataset-root> [...] [--port 8686] [--host 0.0.0.0]')
  process.exit(1)
}
const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = [path.join(here, '..', 'dist'), path.join(here, '..', 'dist-single')].find((d) => existsSync(path.join(d, 'index.html')))
// a fresh clone has no build output: fall back to the committed single-file app (no npm install needed)
const singleFile = path.join(here, '..', 'embodiscope.html')
const data = createDataHandler(roots)

createServer(async (req, res) => {
  if (await data(req, res)) return
  if (!appDir) {
    if (existsSync(singleFile)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      createReadStream(singleFile).pipe(res)
    } else res.end('EmbodiScope data server is running. Build the app first (npm run build) or open the hosted app and connect to this server.')
    return
  }
  const url = new URL(req.url, 'http://x')
  let file = path.join(appDir, decodeURIComponent(url.pathname))
  if (!file.startsWith(appDir) || !existsSync(file) || (await fs.stat(file)).isDirectory()) file = path.join(appDir, 'index.html')
  const ext = path.extname(file)
  res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[ext] ?? 'application/octet-stream')
  createReadStream(file).pipe(res)
}).listen(port, host, () => {
  console.log(`EmbodiScope serving ${roots.join(', ')}\n  → http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`)
})
