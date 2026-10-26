import type { FrameTable } from '@core/data/frameTable'
import type { DatasetEntry } from '@app/store'
import type { PoseTrack } from '@core/analysis/poses'
import { gripperSignal, poseTrack } from '@core/analysis/poses'
import type { CameraModel, Segment } from '@core/semantics/types'
import type { Mat3, Mat4, Vec3 } from '@core/math/rotation'
import { apply3, transpose3 } from '@core/math/rotation'
import { forwardKinematics, leafLinks } from '@core/robot/urdf'
import type { JointDim, RobotBinding } from '@app/robotModel'
import { jointDims } from '@app/robotModel'

export interface TrackItem {
  seg: Segment
  track: PoseTrack
  color: string
  label: string
  gripper?: Float64Array
}

export interface CameraItem {
  cam: CameraModel
  track: PoseTrack
  /** fx fy cx cy per frame (or constant) */
  K: (t: number) => [number, number, number, number] | null
}

export interface SkeletonItem {
  names: string[]
  tracks: PoseTrack[]
  bones: [number, number][]
}

export interface RobotItem {
  name: string
  frame: string
  bones: [string, string][]
  leaves: string[]
  fk: (t: number) => Map<string, Mat4>
}

export interface SceneModel {
  frames: string[]
  parentOf: (seg: Segment) => string
  tracks: TrackItem[]
  actionTracks: TrackItem[]
  cameras: CameraItem[]
  skeleton: SkeletonItem | null
  robot: RobotItem | null
  length: number
}

/** URDF skeleton driven by dataset joint values (deg converted to rad). */
export function robotItem(binding: RobotBinding, dims: JointDim[], table: FrameTable): RobotItem {
  const byId = new Map(dims.map((d) => [d.id, d]))
  const fk = (t: number) => {
    const q = new Map<string, number>()
    for (const [joint, id] of Object.entries(binding.map)) {
      const d = id ? byId.get(id) : undefined
      if (!d) continue
      const v = table.value(d.feature, Math.min(t, table.length - 1), d.dim)
      if (Number.isFinite(v)) q.set(joint, d.deg ? (v * Math.PI) / 180 : v)
    }
    return forwardKinematics(binding.model, q)
  }
  return {
    name: binding.model.name,
    frame: `urdf:${binding.model.root}`,
    bones: binding.model.joints.map((j) => [j.parent, j.child] as [string, string]),
    leaves: leafLinks(binding.model),
    fk,
  }
}

const SIDE_COLOR: Record<string, string> = { left: '#ff9f43', right: '#2ed1ff', center: '#c792ea' }

export const parentOf = (s: Segment) => s.pose?.parent ?? (s.role === 'body_keypoint' ? 'world' : 'base')

export function buildSceneModel(entry: DatasetEntry, table: FrameTable, robot: RobotBinding | null = null): SceneModel {
  const { sem } = entry
  const segs = sem.segments
  const grippers = segs.filter((s) => s.role === 'gripper')
  const findGripper = (s: Segment) => {
    const same = grippers.filter((g) => g.stream === s.stream && g.side === s.side)
    return same.find((g) => g.feature === s.feature) ?? same[0]
  }
  const mk = (s: Segment, i: number): TrackItem | null => {
    const track = poseTrack(table, s)
    if (!track || (!track.pos && !track.rot)) return null
    const g = findGripper(s)
    const shortName = s.pose?.child ?? `${s.side ?? ''}${s.entity && s.entity !== 'pose' ? ' ' + s.entity : ''}`.trim()
    return {
      seg: s,
      track,
      color: SIDE_COLOR[s.side ?? ''] ?? ['#c792ea', '#ffcb6b', '#89ddff', '#f07178'][i % 4],
      label: shortName || s.feature.split('.').pop()!,
      gripper: g ? (gripperSignal(table, g) ?? undefined) : undefined,
    }
  }
  const poseRoles = new Set(['eef_pose', 'eef_position', 'base_pose'])
  const tracks = segs
    .filter((s) => s.stream === 'observation' && poseRoles.has(s.role))
    .map(mk)
    .filter(Boolean) as TrackItem[]
  const actionTracks = segs
    .filter((s) => (s.stream === 'action' || s.stream === 'teleop') && (s.role === 'eef_pose' || s.role === 'eef_position'))
    .map(mk)
    .filter(Boolean) as TrackItem[]

  const cameras: CameraItem[] = []
  for (const cam of sem.cameras) {
    if (!cam.extrinsics) continue
    const seg = segs.find((s) => s.id === cam.extrinsics!.segment)
    if (!seg) continue
    const track = poseTrack(table, seg)
    if (!track) continue
    const kcol = cam.intrinsics ? table.get(cam.intrinsics.feature) : undefined
    const K = (t: number): [number, number, number, number] | null => {
      if (!kcol) return null
      const o = Math.min(t, table.length - 1) * kcol.dim
      const v = kcol.data
      return cam.intrinsics!.layout === 'matrix3x3' ? [v[o], v[o + 4], v[o + 2], v[o + 5]] : [v[o], v[o + 1], v[o + 2], v[o + 3]]
    }
    cameras.push({ cam, track, K })
  }

  const kps = segs.filter((s) => s.stream === 'observation' && s.role === 'body_keypoint')
  const handRoots = segs.filter((s) => s.stream === 'observation' && s.role === 'eef_pose' && s.entity === 'hand')
  let skeleton: SkeletonItem | null = null
  if (kps.length > 3) {
    const all = [...kps, ...handRoots]
    const names = all.map((s) => (s.pose?.child ?? s.entity ?? s.feature).toLowerCase())
    const tracksK = all.map((s) => poseTrack(table, s)!).filter(Boolean)
    skeleton = { names, tracks: tracksK, bones: skeletonBones(names) }
  }

  const robotModel = robot ? robotItem(robot, jointDims(entry), table) : null
  const frames = [...new Set([...tracks, ...actionTracks].map((t) => parentOf(t.seg)).concat(cameras.map((c) => parentOf(c.track.segment))))]
  if (robotModel) frames.push(robotModel.frame)
  return { frames, parentOf, tracks, actionTracks, cameras, skeleton, robot: robotModel, length: table.length }
}

/** Connectivity for ARKit-style body / hand joint names (EgoDex) and generic "<side>_<finger>_<segment>" names. */
export function skeletonBones(names: string[]): [number, number][] {
  const idx = new Map(names.map((n, i) => [n, i]))
  const bones: [number, number][] = []
  const link = (a: string, b: string) => {
    const i = idx.get(a), j = idx.get(b)
    if (i !== undefined && j !== undefined) bones.push([i, j])
  }
  const chain = (list: string[]) => {
    for (let k = 0; k + 1 < list.length; k++) link(list[k], list[k + 1])
  }
  chain(['hip', 'spine1', 'spine2', 'spine3', 'spine4', 'spine5', 'spine6', 'spine7', 'neck1', 'neck2', 'neck3', 'neck4'])
  const fingers = ['thumb', 'index', 'middle', 'ring', 'little']
  const parts = ['metacarpal', 'knuckle', 'intermediate_base', 'intermediate_tip', 'tip']
  for (const side of ['left', 'right']) {
    chain(['spine7', `${side}_shoulder`, `${side}_arm`, `${side}_forearm`, `${side}_hand`])
    for (const f of fingers) {
      const seq = [`${side}_hand`, ...parts.map((p) => `${side}_${f}_${p}`)].filter((n) => idx.has(n))
      chain(seq)
    }
  }
  return bones
}

/** Project a point given in the camera's parent frame into pixel coordinates (OpenCV pinhole). */
export function projectPoint(camPos: Vec3, camRot: Mat3, K: [number, number, number, number], p: Vec3, convention: CameraModel['convention']): [number, number, number] | null {
  // p_cam = R^T (p - t)
  const d: Vec3 = [p[0] - camPos[0], p[1] - camPos[1], p[2] - camPos[2]]
  let c = apply3(transpose3(camRot), d)
  if (convention === 'opengl') c = [c[0], -c[1], -c[2]]
  else if (convention === 'ros_body') c = [-c[1], -c[2], c[0]]
  if (c[2] <= 1e-4) return null
  const [fx, fy, cx, cy] = K
  return [fx * (c[0] / c[2]) + cx, fy * (c[1] / c[2]) + cy, c[2]]
}
