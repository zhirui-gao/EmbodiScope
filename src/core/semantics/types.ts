import type { RotationRepr } from '../math/rotation'

/** Which signal stream a feature belongs to. */
export type Stream = 'observation' | 'action' | 'teleop' | 'label' | 'meta' | 'index' | 'other'

export type Role =
  | 'camera'
  | 'depth'
  | 'joint_position'
  | 'joint_velocity'
  | 'joint_effort'
  | 'joint_current'
  | 'gripper'
  | 'hand_joints'
  | 'eef_pose'
  | 'eef_position'
  | 'delta_position'
  | 'delta_rotation'
  | 'body_keypoint'
  | 'camera_intrinsics'
  | 'camera_extrinsics'
  | 'camera_distortion'
  | 'base_pose'
  | 'base_velocity'
  | 'head'
  | 'torso'
  | 'position_2d'
  | 'label'
  | 'confidence'
  | 'reward'
  | 'done'
  | 'index'
  | 'unknown'

export type Side = 'left' | 'right' | 'center'

export interface RotationSpec {
  repr: RotationRepr
  /** dims (relative to the segment start) holding the rotation, in the order expected by `repr` */
  idx: number[]
  /** set when the representation could not be determined unambiguously from names/conventions */
  ambiguous?: boolean
  alternatives?: RotationRepr[]
}

export interface PoseSpec {
  /** dims (relative to segment start) of x, y, z, or null for rotation-only */
  pos: [number, number, number] | null
  rot: RotationSpec | null
  /** frame names parsed from keys like `left_ee_to_robot_pose` (child=left_ee, parent=robot) */
  child?: string
  parent?: string
}

export interface Units {
  length?: 'm' | 'cm' | 'mm' | 'px' | 'unknown'
  angle?: 'rad' | 'deg' | 'normalized' | 'unknown'
}

export interface GripperSpec {
  /** which raw value means "open" */
  polarity: 'open_high' | 'closed_high' | 'unknown'
  range?: [number, number]
  kind?: 'binary' | 'continuous'
}

/** A contiguous slice of one feature vector that carries a single meaning. */
export interface Segment {
  id: string
  feature: string
  start: number
  end: number
  names: string[]
  stream: Stream
  role: Role
  side?: Side
  /** entity: arm / hand / camera name / body joint name … */
  entity?: string
  pose?: PoseSpec
  units?: Units
  gripper?: GripperSpec
  /** for actions: how the action relates to the state */
  actionType?: 'absolute' | 'delta' | 'velocity' | 'unknown'
  /** paired observation segment id for an action segment */
  pairedWith?: string
  /** 0..1 confidence in this interpretation */
  confidence: number
  evidence: string[]
  /** true when set by a profile, the user or an LLM rather than heuristics */
  overridden?: 'profile' | 'user' | 'llm'
}

export interface CameraModel {
  /** video/image feature key */
  key: string
  name: string
  width?: number
  height?: number
  fps?: number
  codec?: string
  pixFmt?: string
  isDepth?: boolean
  intrinsics?: { feature: string; layout: 'fx_fy_cx_cy' | 'matrix3x3' }
  distortion?: string
  /** pose of the camera (camera -> parent) */
  extrinsics?: { segment: string; parent?: string }
  /** where the camera is mounted, inferred from its name */
  mount: 'head' | 'wrist' | 'third_person' | 'egocentric' | 'unknown'
  /** optical frame convention: opencv = x right, y down, z forward */
  convention: 'opencv' | 'opengl' | 'ros_body' | 'unknown'
}

export type Embodiment =
  | 'single_arm'
  | 'dual_arm'
  | 'mobile_manipulator'
  | 'humanoid'
  | 'human_hand'
  | 'dexterous_hand'
  | 'planar'
  | 'unknown'

export interface FrameEdge {
  child: string
  parent: string
  segment: string
  /** constant over the dataset (e.g. fixed camera) when known */
  static?: boolean
}

export interface DatasetSemantics {
  segments: Segment[]
  cameras: CameraModel[]
  embodiment: Embodiment
  embodimentEvidence: string[]
  /** base pose / velocity actually changes inside episodes */
  mobileBase: boolean
  endEffector: 'parallel_gripper' | 'dexterous_hand' | 'human_hand' | 'none' | 'unknown'
  frames: FrameEdge[]
  /** quick-access: which segments are the "main" state / action used for training */
  primaryState: string[]
  primaryAction: string[]
  conventions: {
    quaternion?: 'xyzw' | 'wxyz' | 'mixed' | 'none'
    rotations: RotationRepr[]
    cameraConvention?: string
    declaredUnits?: Record<string, string>
    source: 'declared' | 'inferred'
  }
  notes: string[]
}
