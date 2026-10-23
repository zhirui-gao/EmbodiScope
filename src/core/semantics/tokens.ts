import type { Side } from './types'

export function tokenize(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

export function sideOf(tokens: string[]): Side | undefined {
  if (tokens.includes('left') || tokens.includes('lh')) return 'left'
  if (tokens.includes('right') || tokens.includes('rh')) return 'right'
  if (tokens.length > 1) {
    if (tokens[0] === 'l') return 'left'
    if (tokens[0] === 'r') return 'right'
  }
  return undefined
}

export const has = (tokens: string[], ...words: string[]) => words.some((w) => tokens.includes(w))

export const EEF_WORDS = ['eef', 'ee', 'tcp', 'effector', 'cartesian', 'tool', 'flange', 'endeffector']
export const GRIPPER_WORDS = ['gripper', 'claw', 'grip', 'grasp', 'openness', 'closedness']
export const FINGER_WORDS = ['thumb', 'index', 'middle', 'ring', 'little', 'pinky', 'finger', 'palm', 'knuckle', 'metacarpal']
export const JOINT_WORDS = [
  'joint', 'joints', 'motor', 'servo', 'qpos', 'waist', 'shoulder', 'elbow', 'wrist', 'forearm', 'pan', 'flex', 'tilt', 'arm',
]
export const BASE_WORDS = ['base', 'chassis', 'odom', 'wheel', 'mobile', 'agv']
export const CAMERA_WORDS = ['camera', 'cam']

/**
 * Per-dimension pose component parsed from a name, e.g.
 * "x" / "position.x" / "left_eef_pos_x" -> pos.x ; "quaternion.w" / "qw" -> quat.w ; "roll" / "r" -> rpy.r ;
 * "rot_x" / "rx" / "ori_x" -> rot.x (ambiguous euler / rotvec)
 */
export type Comp = `pos.${'x' | 'y' | 'z'}` | `quat.${'x' | 'y' | 'z' | 'w'}` | `rpy.${'r' | 'p' | 'y'}` | `rot.${'x' | 'y' | 'z'}` | `r6.${number}`

export function poseComponent(tokens: string[], prev: (Comp | null)[]): Comp | null {
  if (!tokens.length) return null
  const last = tokens[tokens.length - 1]
  const axis = ['x', 'y', 'z', 'w'].includes(last) ? (last as 'x' | 'y' | 'z' | 'w') : null
  if (tokens.length === 1) {
    // bare "r", "p", "y" after x,y,z  (RoboMIND: [x, y, z, r, p, y, gripper])
    if (last === 'r') return 'rpy.r'
    if (last === 'p') return 'rpy.p'
    if (last === 'y' && prev.includes('rpy.p')) return 'rpy.y'
  }
  if (has(tokens, 'roll')) return 'rpy.r'
  if (has(tokens, 'pitch')) return 'rpy.p'
  if (has(tokens, 'yaw') && !has(tokens, 'rate')) return 'rpy.y'
  if (has(tokens, 'qx', 'qy', 'qz', 'qw')) return `quat.${tokens.find((t) => /^q[xyzw]$/.test(t))![1]}` as Comp
  if (axis && has(tokens, 'quaternion', 'quat', 'q', 'orientation_quat')) return `quat.${axis}` as Comp
  if (has(tokens, 'rx', 'ry', 'rz')) return `rot.${tokens.find((t) => /^r[xyz]$/.test(t))![1]}` as Comp
  if (axis && axis !== 'w' && has(tokens, 'rot', 'rotation', 'ori', 'orientation', 'euler', 'angle', 'axis', 'rotvec')) return `rot.${axis}` as Comp
  if (axis && axis !== 'w') return `pos.${axis}` as Comp
  return null
}
