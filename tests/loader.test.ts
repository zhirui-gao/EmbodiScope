import { describe, expect, it } from 'vitest'
import { NodeFsSource } from '../src/core/io/nodeSource'
import { discoverDatasets, flattenNames, loadDataset } from '../src/core/lerobot/loader'
import { loadEpisode } from '../src/core/lerobot/episode'
import { formatTemplate, templateToRegex } from '../src/core/lerobot/template'
import { localDatasetRoots } from './localDatasets'

describe('template', () => {
  it('formats python-style templates', () => {
    expect(formatTemplate('data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet', { episode_chunk: 1, episode_index: 42 })).toBe(
      'data/chunk-001/episode_000042.parquet',
    )
    const { re, vars } = templateToRegex('videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4')
    const m = 'videos/observation.images.top/chunk-000/file-012.mp4'.match(re)!
    expect(vars).toEqual(['video_key', 'chunk_index', 'file_index'])
    expect(m.slice(1)).toEqual(['observation.images.top', '000', '012'])
  })
  it('flattens names', () => {
    expect(flattenNames({ motors: ['a', 'b'] }, 2)).toEqual(['a', 'b'])
    expect(flattenNames(['height', 'width', 'rgb'], 1)).toEqual(['height'])
    expect(flattenNames(null, 3)).toBeNull()
  })
})

const roots = localDatasetRoots()

describe.skipIf(!roots.length)('local datasets', () => {
  for (const root of roots) {
    it(`loads every dataset under ${root}`, async () => {
      const src = new NodeFsSource(root)
      const found = await discoverDatasets(src)
      expect(found.length).toBeGreaterThan(0)
      for (const d of found) {
        const ds = await loadDataset(src, d.root)
        const ep = ds.episodes.find((e) => e.available)
        let summary = `${d.root} ${ds.version} robot=${ds.robotType} fps=${ds.fps} eps=${ds.episodes.length} tasks=${ds.tasks.length} vocab=${ds.extras.vocabularies.map((v) => v.name)}`
        if (ep) {
          const le = await loadEpisode(ds, ep)
          expect(le.table.length).toBeGreaterThan(0)
          summary += ` | ep${ep.index} rows=${le.table.length} numeric=${le.table.numeric.size} raw=${le.table.raw.size} deferred=${le.deferredColumns.length} ${Math.round(le.loadMs)}ms`
          const ts = le.table.get('timestamp')
          if (ts) expect(ts.data[0]).toBeLessThan(1)
        }
        console.log(summary, ds.warnings.length ? `\n   warnings: ${ds.warnings.join(' | ')}` : '')
      }
    })
  }
})
