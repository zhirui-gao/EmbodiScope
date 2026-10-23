import { describe, expect, it } from 'vitest'
import { NodeFsSource } from '../src/core/io/nodeSource'
import { discoverDatasets, loadDataset } from '../src/core/lerobot/loader'
import { loadEpisode } from '../src/core/lerobot/episode'
import { inferSemantics } from '../src/core/semantics/infer'
import { computeEpisodeMetrics } from '../src/core/analysis/episodeMetrics'
import { runChecks } from '../src/core/analysis/qa'
import { datasetCard } from '../src/core/analysis/summary'
import { heuristicSegments } from '../src/core/analysis/segmentation'
import { probeMp4 } from '../src/core/video/mp4'
import { matToQuat, quatToMat, rotationAngle, toMatrix, eulerToMat } from '../src/core/math/rotation'
import { localDatasetRoots } from './localDatasets'

describe('rotation math', () => {
  it('round-trips quaternions', () => {
    const q = [0.1, -0.3, 0.5, 0.8]
    const n = Math.hypot(...q)
    const m = quatToMat(q[0], q[1], q[2], q[3])
    const back = matToQuat(m)
    back.forEach((v, i) => expect(v).toBeCloseTo(q[i] / n, 6))
  })
  it('treats wxyz and xyzw consistently', () => {
    const a = toMatrix('quat_xyzw', [0.1, 0.2, 0.3, 0.9])
    const b = toMatrix('quat_wxyz', [0.9, 0.1, 0.2, 0.3])
    expect(rotationAngle(a, b)).toBeCloseTo(0, 6)
  })
  it('extrinsic xyz equals intrinsic ZYX with reversed angles', () => {
    const a = eulerToMat(0.3, -0.2, 1.1, 'xyz')
    const b = eulerToMat(1.1, -0.2, 0.3, 'ZYX')
    expect(rotationAngle(a, b)).toBeCloseTo(0, 6)
  })
})

const roots = localDatasetRoots()

describe.skipIf(!roots.length)('analysis on local datasets', () => {
  for (const root of roots) {
    it(`analyses ${root}`, async () => {
      const src = new NodeFsSource(root)
      for (const d of await discoverDatasets(src)) {
        const ds = await loadDataset(src, d.root)
        const sem = inferSemantics(ds)
        const eps = ds.episodes.filter((e) => e.available).slice(0, 4)
        const metrics = []
        let segs = 0
        for (const ep of eps) {
          const le = await loadEpisode(ds, ep)
          metrics.push(computeEpisodeMetrics(ds, sem, le.table, ep.index))
          segs += heuristicSegments(le.table, sem, ds.fps).length
        }
        const vk = Object.values(eps[0]?.videos ?? {})[0]
        const probe = vk ? await probeMp4(await ds.source.asyncBuffer(vk.path)) : undefined
        const issues = runChecks({ ds, sem, metrics })
        const card = datasetCard(ds, sem)
        expect(card.episodes).toBe(ds.episodes.length)
        const m0 = metrics[0]
        console.log(
          `${d.root}\n   card: ${card.embodiment} | state ${card.stateDim}: ${card.stateComposition} | action ${card.actionDim}: ${card.actionComposition} | space=${card.actionSpace} type=${card.actionType} | annot L=${card.annotation.levels.join(',')} score=${card.annotation.granularityScore}\n` +
            `   video: ${probe ? `${probe.codec} ${probe.width}x${probe.height} ${probe.frames}f ${probe.fps?.toFixed(2)}fps ${probe.duration?.toFixed(1)}s ${probe.error ?? ''}` : 'none'}\n` +
            `   ep${m0?.episode}: idle ${m0?.idleHead.toFixed(1)}/${m0?.idleTail.toFixed(1)}s ratio ${m0?.idleRatio.toFixed(2)} gripperEv ${m0?.gripperEvents} lag ${JSON.stringify(Object.fromEntries(Object.entries(m0?.actionLag ?? {}).slice(0, 2).map(([k, v]) => [k, `${v.lag}${v.identical ? '=' : ''}`])))} heurSegs/ep ${(segs / Math.max(1, eps.length)).toFixed(1)}\n` +
            issues.map((i) => `   [${i.severity}] ${i.title.en} — ${i.detail.en.slice(0, 140)}`).join('\n'),
        )
      }
    })
  }
})
