import type { LeRobotDataset } from '../lerobot/types'
import type { Segment } from './types'

/**
 * Dataset profiles encode knowledge that cannot be inferred from names or values
 * (documented conventions of well-known datasets). Each profile matches a dataset
 * and patches the inferred segments. Add new profiles here — see docs/CONTRIBUTING.md.
 */
export interface DatasetProfile {
  id: string
  label: string
  /** link to the documentation the profile is based on */
  reference?: string
  match(ds: LeRobotDataset): boolean
  apply(segments: Segment[], ds: LeRobotDataset): Segment[]
}

const byFeature = (segments: Segment[], feature: string) => segments.filter((s) => s.feature === feature)
const mark = (s: Segment, ev: string) => {
  s.overridden = 'profile'
  s.confidence = Math.max(s.confidence, 0.9)
  s.evidence.push(ev)
}

export const PROFILES: DatasetProfile[] = [
  {
    id: 'openx-rt1-fractal',
    label: 'Open X-Embodiment / RT-1 (fractal20220817)',
    reference: 'https://github.com/google-deepmind/open_x_embodiment',
    match: (ds) => ds.features.some((f) => f.key.endsWith('base_pose_tool_reached')),
    apply(segments) {
      for (const s of segments) {
        if (s.feature.endsWith('base_pose_tool_reached')) {
          s.role = 'eef_pose'
          s.pose = { pos: [0, 1, 2], rot: { repr: 'quat_xyzw', idx: [3, 4, 5, 6] }, child: 'tool', parent: 'base' }
          mark(s, 'RT-1: base_pose_tool_reached = tool pose in robot base frame, xyz + quaternion (x, y, z, w)')
        }
        if (s.feature.endsWith('gripper_closed') || s.feature.endsWith('gripper_closedness_action')) {
          s.role = 'gripper'
          s.gripper = { ...(s.gripper ?? { polarity: 'closed_high' }), polarity: 'closed_high' }
          mark(s, 'RT-1: gripper closedness, 1 = closed')
        }
        if (s.feature.endsWith('rotation_delta')) {
          s.role = 'delta_rotation'
          s.pose = { pos: null, rot: { repr: 'euler_xyz', idx: [0, 1, 2] } }
          mark(s, 'RT-1: rotation_delta = roll / pitch / yaw delta of the end effector')
        }
        if (s.feature.endsWith('terminate_episode')) {
          s.role = 'done'
          s.stream = 'meta'
          mark(s, 'RT-1: one-hot terminate flag')
        }
      }
      return segments
    },
  },
  {
    id: 'lerobot-pusht',
    label: 'LeRobot PushT (2D simulation)',
    reference: 'https://huggingface.co/datasets/lerobot/pusht',
    match: (ds) =>
      ds.features.some((f) => f.key === 'observation.state' && f.dim === 2) && ds.features.some((f) => f.key === 'action' && f.dim === 2),
    apply(segments) {
      for (const s of segments) {
        if (s.feature === 'observation.state' || s.feature === 'action') {
          s.role = 'position_2d'
          s.units = { length: 'px' }
          s.actionType = s.stream === 'action' ? 'absolute' : undefined
          mark(s, 'PushT: 2D agent / target position in pixel space (512×512)')
        }
      }
      return segments
    },
  },
  {
    id: 'droid',
    label: 'DROID (LeRobot conversion)',
    reference: 'https://droid-dataset.github.io/',
    match: (ds) => /droid/i.test(ds.name) && ds.features.some((f) => f.key === 'observation.state' && f.dim === 7),
    apply(segments, ds) {
      const st = byFeature(segments, 'observation.state')
      if (st.length === 1 || st.some((s) => s.role === 'eef_pose')) {
        const f = ds.features.find((x) => x.key === 'observation.state')!
        const names = f.names ?? Array.from({ length: 7 }, (_, i) => `motor_${i}`)
        const base = st[0]
        const pose: Segment = {
          ...base,
          id: 'observation.state[0:6]',
          start: 0,
          end: 6,
          names: names.slice(0, 6),
          role: 'eef_pose',
          pose: { pos: [0, 1, 2], rot: { repr: 'euler_xyz', idx: [3, 4, 5] }, child: 'eef', parent: 'robot_base' },
          units: { length: 'm', angle: 'rad' },
          evidence: [],
          confidence: 0.85,
        }
        mark(pose, 'DROID: cartesian_position = xyz + extrinsic xyz euler of the Franka EEF in the robot base frame')
        const grip: Segment = { ...base, id: 'observation.state[6:7]', start: 6, end: 7, names: names.slice(6), role: 'gripper', pose: undefined, units: undefined, gripper: { polarity: 'closed_high', range: [0, 1] }, evidence: [], confidence: 0.85 }
        mark(grip, 'DROID: gripper_position in [0, 1], 1 = closed')
        segments = segments.filter((s) => s.feature !== 'observation.state').concat([pose, grip])
      }
      const act = byFeature(segments, 'action')[0]
      const af = ds.features.find((x) => x.key === 'action')
      if (act && af?.dim === 7) {
        const names = af.names ?? Array.from({ length: 7 }, (_, i) => `motor_${i}`)
        const mk = (start: number, end: number, role: Segment['role'], ev: string): Segment => {
          const s: Segment = { ...act, id: `action[${start}:${end}]`, start, end, names: names.slice(start, end), role, pose: undefined, units: undefined, actionType: role === 'gripper' ? 'absolute' : 'velocity', evidence: [], confidence: 0.8 }
          mark(s, ev)
          return s
        }
        segments = segments
          .filter((s) => s.feature !== 'action')
          .concat([
            mk(0, 3, 'delta_position', 'DROID (LeRobot): cartesian linear velocity, normalised to [-1, 1]'),
            mk(3, 6, 'delta_rotation', 'DROID (LeRobot): cartesian angular velocity, normalised to [-1, 1]'),
            mk(6, 7, 'gripper', 'DROID (LeRobot): gripper command'),
          ])
      }
      return segments
    },
  },
]

export function matchingProfiles(ds: LeRobotDataset): DatasetProfile[] {
  return PROFILES.filter((p) => {
    try {
      return p.match(ds)
    } catch {
      return false
    }
  })
}

export function applyProfiles(ds: LeRobotDataset, segments: Segment[]): Segment[] {
  for (const p of matchingProfiles(ds)) segments = p.apply(segments, ds)
  return segments
}
