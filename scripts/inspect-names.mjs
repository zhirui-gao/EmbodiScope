// Dev helper: print feature dtypes / shapes / names (+ modality.json, conversion.json) of every dataset under a folder.
//   node scripts/inspect-names.mjs <root>
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2]
const walk = (dir, depth = 0) => {
  if (fs.existsSync(path.join(dir, 'meta', 'info.json'))) return [dir]
  if (depth > 4) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .flatMap((e) => walk(path.join(dir, e.name), depth + 1))
}
for (const d of walk(root)) {
  const j = JSON.parse(fs.readFileSync(path.join(d, 'meta', 'info.json')))
  console.log(`=== ${path.relative(root, d)} (${j.codebase_version}, ${j.robot_type})`)
  for (const [k, v] of Object.entries(j.features)) {
    if (/index|timestamp/.test(k)) continue
    console.log('  ' + k, v.dtype, JSON.stringify(v.shape), String(JSON.stringify(v.names)).slice(0, 500))
  }
  for (const f of ['modality.json', 'conversion.json']) {
    const m = path.join(d, 'meta', f)
    if (fs.existsSync(m)) console.log(`  ${f}: ${fs.readFileSync(m, 'utf8').replace(/\s+/g, ' ').slice(0, 1800)}`)
  }
}
