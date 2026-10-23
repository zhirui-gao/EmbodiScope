import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { NodeFsSource } from '../src/core/io/nodeSource'
import { loadDataset } from '../src/core/lerobot/loader'
import { loadEpisode } from '../src/core/lerobot/episode'
import { inferSemantics } from '../src/core/semantics/infer'
import { poseTrack, posAt, rotAt } from '../src/core/analysis/poses'
import { projectPoint } from '../src/ui/scene/model'

const AGIBOT = 'C:/Users/Administrator/Desktop/workspace/dataset/dataset'
const EGODEX = 'C:/Users/Administrator/Desktop/dataset_demo/dataset_demo'

describe('pinhole projection', () => {
  it('projects a point in front of an identity camera to the principal point', () => {
    const I = [1, 0, 0, 0, 1, 0, 0, 0, 1]
    const p = projectPoint([0, 0, 0], I, [500, 500, 320, 240], [0, 0, 2], 'opencv')!
    expect(p[0]).toBeCloseTo(320)
    expect(p[1]).toBeCloseTo(240)
  })

  for (const [root, ds, ep] of [
    [AGIBOT, 'agibot/task_694', 0],
    [EGODEX, 'egodex_new/arrange_topple_dominoes', 1],
  ] as const) {
    it.skipIf(!existsSync(root))(`projects EEF of ${ds} into its head camera`, async () => {
      const d = await loadDataset(new NodeFsSource(root), ds)
      const sem = inferSemantics(d)
      const le = await loadEpisode(d, d.episodes.find((e) => e.index === ep)!)
      const cam = sem.cameras.find((c) => c.name === 'head')!
      const extr = sem.segments.find((s) => s.id === cam.extrinsics!.segment)!
      const ct = poseTrack(le.table, extr)!
      const K = le.table.vector(cam.intrinsics!.feature, 0)
      for (const s of sem.segments.filter((x) => x.role === 'eef_pose' && x.stream === 'observation' && x.pose?.parent === extr.pose?.parent)) {
        const tr = poseTrack(le.table, s)!
        for (const f of [0, Math.floor(le.table.length / 2)]) {
          const uv = projectPoint(posAt(ct, f)!, rotAt(ct, f)!, K as any, posAt(tr, f)!, 'opencv')
          console.log(ds, s.id, 'frame', f, 'K', K.map((x) => x.toFixed(0)).join(','), 'uv', uv?.map((x) => x.toFixed(1)).join(', '))
        }
      }
    })
  }
})
