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

type Part = Pick<Segment, 'role'> & Partial<Pick<Segment, 'side' | 'entity' | 'pose' | 'gripper' | 'actionType' | 'units'>> & { start: number; end: number }

/** Replace every segment of `feature` with an explicit, documented layout. */
function layout(ds: LeRobotDataset, segments: Segment[], feature: string, stream: Segment['stream'], parts: Part[], ev: string): Segment[] {
  const f = ds.features.find((x) => x.key === feature)
  if (!f) return segments
  const names = f.names ?? Array.from({ length: f.dim }, (_, i) => `${feature}[${i}]`)
  const made = parts.map((p) => {
    const s: Segment = {
      id: p.start === 0 && p.end === f.dim ? feature : `${feature}[${p.start}:${p.end}]`,
      feature,
      names: names.slice(p.start, p.end),
      stream,
      confidence: 0.9,
      evidence: [],
      ...p,
    }
    mark(s, ev)
    return s
  })
  return segments.filter((s) => s.feature !== feature).concat(made)
}
const keyOf = (ds: LeRobotDataset, ...keys: string[]) => keys.find((k) => ds.features.some((f) => f.key === k))
const dimOf = (ds: LeRobotDataset, key?: string) => ds.features.find((f) => f.key === key)?.dim
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

PROFILES.push(
  {
    id: 'libero',
    label: 'LIBERO (robosuite Panda, OSC_POSE)',
    reference: 'https://libero-project.github.io/',
    // physical-intelligence/libero (state/actions), lerobot/libero & HuggingFaceVLA/libero, IPEC-COMMUNITY/libero_*
    match: (ds) => {
      const st = keyOf(ds, 'observation.state', 'state')
      const ac = keyOf(ds, 'action', 'actions')
      return /panda|franka/i.test(ds.robotType) && dimOf(ds, st) === 8 && dimOf(ds, ac) === 7 && (/libero/i.test(ds.name + ds.source.label) || ds.tasks.some((t) => /libero|put the|open the|turn on the stove/i.test(t.text)))
    },
    apply(segments, ds) {
      const st = keyOf(ds, 'observation.state', 'state')!
      const ac = keyOf(ds, 'action', 'actions')!
      segments = layout(ds, segments, st, 'observation', [
        { start: 0, end: 6, role: 'eef_pose', pose: { pos: [0, 1, 2], rot: { repr: 'rotvec', idx: [3, 4, 5] }, child: 'eef', parent: 'world' }, units: { length: 'm', angle: 'rad' } },
        { start: 6, end: 8, role: 'gripper', gripper: { polarity: 'open_high' }, units: { length: 'm' } },
      ], 'LIBERO: state = robosuite robot0_eef_pos + axis-angle of robot0_eef_quat (world frame) + 2 finger joint positions')
      segments = layout(ds, segments, ac, 'action', [
        { start: 0, end: 3, role: 'delta_position', actionType: 'delta' },
        { start: 3, end: 6, role: 'delta_rotation', actionType: 'delta', pose: { pos: null, rot: { repr: 'rotvec', idx: [0, 1, 2] } } },
        { start: 6, end: 7, role: 'gripper', actionType: 'absolute', gripper: { polarity: 'closed_high', range: [-1, 1] } },
      ], 'LIBERO: OSC_POSE action = normalised Δxyz + Δaxis-angle in [-1, 1] (scaled by the controller), gripper -1 open / +1 close')
      return segments
    },
  },
  {
    id: 'robocasa-gr00t',
    label: 'RoboCasa (robosuite PandaOmron, GR00T layout)',
    reference: 'https://robocasa.ai/',
    match: (ds) => /robocasa|pandaomron/i.test(ds.robotType + ds.name) && dimOf(ds, 'observation.state') === 16 && dimOf(ds, 'action') === 12 && !ds.extras.modality,
    apply(segments, ds) {
      segments = layout(ds, segments, 'observation.state', 'observation', [
        { start: 0, end: 7, role: 'base_pose', pose: { pos: [0, 1, 2], rot: { repr: 'quat_xyzw', idx: [3, 4, 5, 6] }, child: 'mobile_base', parent: 'world' }, units: { length: 'm' } },
        { start: 7, end: 14, role: 'eef_pose', pose: { pos: [0, 1, 2], rot: { repr: 'quat_xyzw', idx: [3, 4, 5, 6] }, child: 'eef', parent: 'mobile_base' }, units: { length: 'm' } },
        { start: 14, end: 16, role: 'gripper', gripper: { polarity: 'open_high' } },
      ], 'RoboCasa (GR00T modality): base_position + base_rotation (xyzw) | end_effector_position/rotation_relative (xyzw) | gripper_qpos — verify order for custom conversions')
      segments = layout(ds, segments, 'action', 'action', [
        { start: 0, end: 4, role: 'base_velocity', actionType: 'velocity' },
        { start: 4, end: 5, role: 'label', entity: 'control_mode' },
        { start: 5, end: 8, role: 'delta_position', actionType: 'delta' },
        { start: 8, end: 11, role: 'delta_rotation', actionType: 'delta', pose: { pos: null, rot: { repr: 'rotvec', idx: [0, 1, 2] } } },
        { start: 11, end: 12, role: 'gripper', actionType: 'absolute', gripper: { polarity: 'closed_high', range: [-1, 1] } },
      ], 'RoboCasa (GR00T modality): base_motion(4) | control_mode | Δeef xyz | Δeef axis-angle | gripper_close')
      return segments
    },
  },
  {
    id: 'robotwin-eef',
    label: 'RoboTwin (SAPIEN, EEF xyz + quaternion)',
    reference: 'https://robotwin-platform.github.io/',
    match: (ds) => /aloha|robotwin/i.test(ds.robotType + ds.name) && ds.features.some((f) => f.names?.some((n) => /left_q1$/.test(n))),
    apply(segments) {
      for (const s of segments)
        if (s.pose?.rot && s.names.some((n) => /_q[1-4]$/.test(n))) {
          s.pose.rot = { ...s.pose.rot, repr: 'quat_wxyz', ambiguous: false }
          mark(s, 'RoboTwin end poses come from SAPIEN Pose (p, q) with q = (w, x, y, z)')
        }
      return segments
    },
  },
)

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
