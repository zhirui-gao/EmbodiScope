import { describe, expect, it } from 'vitest'
import { NodeFsSource } from '../src/core/io/nodeSource'
import { discoverDatasets, loadDataset } from '../src/core/lerobot/loader'
import { inferSemantics, splitStream } from '../src/core/semantics/infer'
import { poseComponent, tokenize } from '../src/core/semantics/tokens'
import { localDatasetRoots } from './localDatasets'

describe('tokens', () => {
  it('parses pose components', () => {
    const prev: any[] = []
    const names = ['x', 'y', 'z', 'r', 'p', 'y', 'gripper']
    const comps = names.map((n) => {
      const c = poseComponent(tokenize(n), prev)
      prev.push(c)
      return c
    })
    expect(comps).toEqual(['pos.x', 'pos.y', 'pos.z', 'rpy.r', 'rpy.p', 'rpy.y', null])
    expect(poseComponent(tokenize('quaternion.w'), [])).toBe('quat.w')
    expect(poseComponent(tokenize('left_eef_rot_x'), [])).toBe('rot.x')
  })
  it('splits streams', () => {
    expect(splitStream('observation.state.left_ee_to_robot_pose')).toEqual({ stream: 'observation', rest: 'left_ee_to_robot_pose' })
    expect(splitStream('actions.left_joint.position').stream).toBe('action')
    expect(splitStream('eef_sim_pose_state')).toEqual({ stream: 'observation', rest: 'eef_sim_pose' })
  })
})

const roots = localDatasetRoots()

describe.skipIf(!roots.length)('semantics on local datasets', () => {
  for (const root of roots) {
    it(`infers ${root}`, async () => {
      const src = new NodeFsSource(root)
      for (const d of await discoverDatasets(src)) {
        const ds = await loadDataset(src, d.root)
        const sem = inferSemantics(ds)
        expect(sem.segments.length).toBeGreaterThan(0)
        const lines = sem.segments
          .filter((s) => s.role !== 'index' && s.role !== 'body_keypoint')
          .map(
            (s) =>
              `   ${s.stream.padEnd(11)} ${s.role.padEnd(18)} ${(s.side ?? '').padEnd(5)} ${s.id.padEnd(48)} ${s.pose?.rot ? s.pose.rot.repr + (s.pose.rot.ambiguous ? '?' : '') : ''} ${s.pose?.parent ? `${s.pose.child}->${s.pose.parent}` : ''} ${s.units ? JSON.stringify(s.units) : ''} ${s.gripper ? s.gripper.polarity : ''} ${s.actionType ?? ''} ${s.pairedWith ? '<=> ' + s.pairedWith : ''}`,
          )
        const kp = sem.segments.filter((s) => s.role === 'body_keypoint').length
        console.log(
          `${d.root}: ${sem.embodiment} ee=${sem.endEffector} quat=${sem.conventions.quaternion} rot=${sem.conventions.rotations} kp=${kp}\n` +
            `   cams: ${sem.cameras.map((c) => `${c.name}(${c.mount}${c.intrinsics ? ',K' : ''}${c.extrinsics ? ',T' : ''})`).join(' ')}\n` +
            `   frames: ${sem.frames.map((e) => `${e.child}->${e.parent}`).join(', ')}\n` +
            lines.join('\n') +
            (sem.notes.length ? '\n   notes: ' + sem.notes.join(' | ') : ''),
        )
      }
    })
  }
})
