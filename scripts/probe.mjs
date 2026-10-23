// Dev helper: print parquet schema + first rows of a file.
// usage: node scripts/probe.mjs <file.parquet> [rows]
import { asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects, parquetSchema } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'

const path = process.argv[2]
const n = Number(process.argv[3] ?? 2)
const file = await asyncBufferFromFile(path)
const md = await parquetMetadataAsync(file)
const schema = parquetSchema(md)
console.log('rows', Number(md.num_rows), 'rowGroups', md.row_groups.length, 'kv', (md.key_value_metadata ?? []).map((k) => k.key))
for (const c of schema.children) {
  const leaf = (s) => (s.children.length ? leaf(s.children[0]) : s.element)
  const l = leaf(c)
  console.log(' ', c.element.name, c.element.repetition_type ?? '', l.type, l.logical_type?.type ?? l.converted_type ?? '', c.children.length ? '(nested)' : '')
}
const rows = await parquetReadObjects({ file, rowStart: 0, rowEnd: n, compressors })
const fmt = (v) => {
  if (typeof v === 'bigint') return Number(v)
  if (Array.isArray(v)) return v.length > 12 ? `[${v.slice(0, 12).map(fmt).join(', ')} ... (${v.length})]` : v.map(fmt)
  if (typeof v === 'number') return Math.round(v * 1e5) / 1e5
  return v
}
for (const r of rows) {
  const o = {}
  for (const [k, v] of Object.entries(r)) o[k] = fmt(v)
  console.log(JSON.stringify(o).slice(0, 4000))
}
