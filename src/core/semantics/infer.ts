import type { FeatureSpec, FeatureStats, LeRobotDataset } from '../lerobot/types'
import { INDEX_KEYS } from '../lerobot/types'
import type { RotationRepr } from '../math/rotation'
import { applyProfiles } from './profiles'
import type { Comp } from './tokens'
import {
  BASE_WORDS,
  CAMERA_WORDS,
  EEF_WORDS,
  FINGER_WORDS,
  GRIPPER_WORDS,
  JOINT_WORDS,
  has,
  poseComponent,
  sideOf,
  tokenize,
} from './tokens'
import type {
  CameraModel,
  DatasetSemantics,
  Embodiment,
  FrameEdge,
  PoseSpec,
  Role,
  RotationSpec,
  Segment,
  Side,
  Stream,
} from './types'

// ----------------------------------------------------------------------------- stream

export function splitStream(key: string): { stream: Stream; rest: string } {
  const k = key
  const pre: [RegExp, Stream][] = [
    [/^observation\.state(\.|$)/, 'observation'],
    [/^observations?\./, 'observation'],
    [/^states?(\.|$)/, 'observation'],
    [/^actions?(\.|$)/, 'action'],
    [/^(master_actions?|teleop|leader)(\.|$)/, 'teleop'],
    [/^next\./, 'meta'],
  ]
  for (const [re, stream] of pre) {
    const m = k.match(re)
    if (m) return { stream, rest: k.slice(m[0].length) }
  }
  if (/_state$/.test(k)) return { stream: 'observation', rest: k.replace(/_state$/, '') }
  if (/_action$/.test(k)) return { stream: 'action', rest: k.replace(/_action$/, '') }
  if (/annotation/.test(k)) return { stream: 'label', rest: k }
  return { stream: 'other', rest: k }
}

// ----------------------------------------------------------------------------- helpers

const POSE_KEY = /^(.*)_to_(.*?)_(pose|poses|extrinsics?|transform|tf)$/

function parsePoseKey(rest: string): { child: string; parent: string } | null {
  const parts = rest.split('.')
  const last = parts[parts.length - 1]
  const m = last.match(POSE_KEY)
  if (!m) return null
  let child = m[1]
  if ((child === 'camera' || child === 'cam') && parts.length > 1) child = `${parts[parts.length - 2]}_camera`
  return { child, parent: m[2] }
}

function cameraNameFrom(tokens: string[]): string {
  return tokens.filter((t) => !CAMERA_WORDS.includes(t) && !['to', 'pose', 'extrinsics', 'extrinsic', 'intrinsics', 'intrinsic', 'distortion', 'robot', 'world', 'observation'].includes(t)).join('_')
}

function statRange(stats: FeatureStats | undefined, start: number, end: number) {
  if (!stats?.min || !stats?.max) return null
  const min = stats.min.slice(start, end)
  const max = stats.max.slice(start, end)
  const mean = stats.mean?.slice(start, end)
  const std = stats.std?.slice(start, end)
  if (min.length !== end - start) return null
  return { min, max, mean, std }
}

let segCounter = 0
function seg(feature: FeatureSpec, stream: Stream, role: Role, start: number, end: number, extra: Partial<Segment> = {}): Segment {
  segCounter++
  const names = feature.names ? feature.names.slice(start, end) : Array.from({ length: end - start }, (_, i) => `${feature.key}[${start + i}]`)
  const whole = start === 0 && end === feature.dim
  return {
    id: whole ? feature.key : `${feature.key}[${start}:${end}]`,
    feature: feature.key,
    start,
    end,
    names,
    stream,
    role,
    confidence: 0.5,
    evidence: [],
    ...extra,
  }
}

/** Build a PoseSpec from per-dim components (relative indices). */
function poseFromComps(comps: (Comp | null)[], declaredQuat?: string): PoseSpec | null {
  const find = (c: Comp) => comps.indexOf(c)
  const px = find('pos.x'), py = find('pos.y'), pz = find('pos.z')
  const pos: [number, number, number] | null = px >= 0 && py >= 0 && pz >= 0 ? [px, py, pz] : null
  let rot: RotationSpec | null = null
  const qx = find('quat.x'), qy = find('quat.y'), qz = find('quat.z'), qw = find('quat.w')
  if (qx >= 0 && qy >= 0 && qz >= 0 && qw >= 0) {
    rot = qw < qx ? { repr: 'quat_wxyz', idx: [qw, qx, qy, qz] } : { repr: 'quat_xyzw', idx: [qx, qy, qz, qw] }
  } else {
    const r = find('rpy.r'), p = find('rpy.p'), y = find('rpy.y')
    if (r >= 0 && p >= 0 && y >= 0) rot = { repr: 'euler_xyz', idx: [r, p, y] }
    else {
      const rx = find('rot.x'), ry = find('rot.y'), rz = find('rot.z')
      if (rx >= 0 && ry >= 0 && rz >= 0)
        rot = { repr: 'euler_xyz', idx: [rx, ry, rz], ambiguous: true, alternatives: ['euler_xyz', 'rotvec', 'euler_XYZ', 'euler_zyx'] }
    }
  }
  if (!pos && !rot) return null
  void declaredQuat
  return { pos, rot }
}

/** Pose layout from dimension count only (no usable names). */
function poseFromDim(dim: number, declaredQuat?: string): PoseSpec | null {
  const q: RotationRepr = declaredQuat === 'wxyz' ? 'quat_wxyz' : 'quat_xyzw'
  switch (dim) {
    case 3:
      return { pos: [0, 1, 2], rot: null }
    case 4:
      return { pos: null, rot: { repr: q, idx: [0, 1, 2, 3], ambiguous: !declaredQuat, alternatives: ['quat_xyzw', 'quat_wxyz'] } }
    case 6:
      return { pos: [0, 1, 2], rot: { repr: 'euler_xyz', idx: [3, 4, 5], ambiguous: true, alternatives: ['euler_xyz', 'rotvec', 'euler_XYZ', 'euler_zyx'] } }
    case 7:
      return { pos: [0, 1, 2], rot: { repr: q, idx: [3, 4, 5, 6], ambiguous: !declaredQuat, alternatives: ['quat_xyzw', 'quat_wxyz'] } }
    case 9:
      return { pos: [0, 1, 2], rot: { repr: 'rot6d', idx: [3, 4, 5, 6, 7, 8] } }
    case 12:
      return { pos: [0, 1, 2], rot: { repr: 'matrix', idx: [3, 4, 5, 6, 7, 8, 9, 10, 11] } }
    default:
      return null
  }
}

// ----------------------------------------------------------------------------- per-dim labelling

type DimKind = 'gripper' | 'hand' | 'pose' | 'joint' | 'base' | 'head' | 'torso' | 'generic'
interface DimLabel {
  side?: Side
  kind: DimKind
  comp: Comp | null
}

function labelDims(names: string[]): DimLabel[] {
  const comps: (Comp | null)[] = []
  const out: DimLabel[] = []
  for (const name of names) {
    const tk = tokenize(name)
    const comp = poseComponent(tk, comps)
    comps.push(comp)
    let kind: DimKind = 'generic'
    const side = sideOf(tk)
    if (has(tk, ...GRIPPER_WORDS)) kind = 'gripper'
    else if (has(tk, 'hand') && (has(tk, 'joint') || has(tk, ...FINGER_WORDS))) kind = 'hand'
    else if (has(tk, ...FINGER_WORDS)) kind = 'hand'
    // arm joint names win over pose words: "wrist_roll", "forearm_roll", "shoulder_lift"
    else if (has(tk, ...JOINT_WORDS) && !has(tk, ...EEF_WORDS) && !(comp && (comp.startsWith('pos.') || comp.startsWith('quat.') || has(tk, 'quaternion', 'quat', 'rot', 'ori')))) kind = 'joint'
    // aloha: "left_waist" is the first arm joint, not a torso joint
    else if (has(tk, 'waist') && side) kind = 'joint'
    else if (comp) kind = 'pose'
    else if (has(tk, 'head', 'neck')) kind = 'head'
    else if (has(tk, 'torso', 'lift', 'spine', 'waist')) kind = 'torso'
    else if (has(tk, ...BASE_WORDS)) kind = 'base'
    out.push({ side, kind, comp: kind === 'joint' ? null : comp })
  }
  return out
}

function groupDims(labels: DimLabel[]): { start: number; end: number; label: DimLabel }[] {
  const groups: { start: number; end: number; label: DimLabel }[] = []
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i]
    const g = groups[groups.length - 1]
    if (g && g.label.kind === l.kind && g.label.side === l.side) {
      // a new pose starts when a component repeats (two poses back to back without side tokens)
      if (l.kind === 'pose' && l.comp && labels.slice(g.start, i).some((x) => x.comp === l.comp)) {
        groups.push({ start: i, end: i + 1, label: l })
        continue
      }
      g.end = i + 1
    } else groups.push({ start: i, end: i + 1, label: l })
  }
  return groups
}

// ----------------------------------------------------------------------------- feature classification

interface Ctx {
  ds: LeRobotDataset
  declaredQuat?: string
  vocabNames: string[]
}

function classifyFeature(f: FeatureSpec, ctx: Ctx): Segment[] {
  const { stream, rest } = splitStream(f.key)
  const tk = tokenize(rest || f.key)
  const keyTk = tokenize(f.key)
  const side = sideOf(tk)
  const stats = ctx.ds.stats?.[f.key]

  if (INDEX_KEYS.has(f.key)) return [seg(f, 'index', 'index', 0, f.dim, { confidence: 1, evidence: ['standard LeRobot index column'] })]
  if (stream === 'meta' || has(keyTk, 'reward', 'done', 'success', 'terminate', 'terminal', 'is_last', 'is_first')) {
    const role: Role = has(keyTk, 'reward') ? 'reward' : 'done'
    return [seg(f, 'meta', role, 0, f.dim, { confidence: 0.9, evidence: [`key mentions ${role}`] })]
  }
  if (has(keyTk, 'confidence')) return [seg(f, 'meta', 'confidence', 0, f.dim, { confidence: 0.9, evidence: ['key mentions confidence'] })]

  // categorical annotations stored as int columns (RoboCoIN …)
  const isInt = /int|bool/.test(f.dtype)
  const vocab = ctx.vocabNames.find((v) => f.key === v || f.key.startsWith(v + '_') || f.key === v + '_annotation')
  if (isInt && (vocab || stream === 'label' || has(keyTk, 'annotation', 'label', 'phase', 'stage'))) {
    return [seg(f, 'label', 'label', 0, f.dim, { entity: vocab ?? rest, confidence: vocab ? 0.95 : 0.7, evidence: [vocab ? `matches vocabulary "${vocab}"` : 'integer annotation column'] })]
  }

  if (has(tk, 'intrinsic', 'intrinsics')) {
    return [seg(f, 'meta', 'camera_intrinsics', 0, f.dim, { entity: cameraNameFrom(tk), confidence: 0.95, evidence: ['key mentions intrinsics'] })]
  }
  if (has(tk, 'distortion')) return [seg(f, 'meta', 'camera_distortion', 0, f.dim, { entity: cameraNameFrom(tk), confidence: 0.95, evidence: ['key mentions distortion'] })]

  // "<child>_to_<parent>_pose"
  const pk = parsePoseKey(rest || f.key)
  if (pk || has(tk, 'extrinsic', 'extrinsics')) {
    const childTk = tokenize(pk?.child ?? rest)
    const pose = (f.names ? poseFromComps(labelDims(f.names).map((l) => l.comp), ctx.declaredQuat) : null) ?? poseFromDim(f.dim, ctx.declaredQuat)
    if (pose && pk) {
      pose.child = pk.child
      pose.parent = pk.parent
    }
    let role: Role
    let entity = pk?.child
    if (has(childTk, ...CAMERA_WORDS) || has(tk, 'extrinsic', 'extrinsics')) {
      role = 'camera_extrinsics'
      entity = cameraNameFrom(childTk.length ? childTk : tk)
    } else if (ctx.ds.robotType.toLowerCase().includes('human') ? childTk.length <= 2 && childTk[childTk.length - 1] === 'hand' && !!sideOf(childTk) : has(childTk, ...EEF_WORDS, 'gripper', 'end', 'hand') && !has(childTk, ...FINGER_WORDS)) {
      // robots: ee / tcp / gripper poses; humans: the wrist ("left_hand") pose acts as the end effector
      role = 'eef_pose'
      if (childTk.includes('hand')) entity = 'hand'
    } else if (childTk.every((t) => ['robot', 'base', 'chassis', 'body', 'link', 'mobile'].includes(t)) && has(tokenize(pk?.parent ?? ''), 'world', 'odom', 'env', 'map', 'odometry')) {
      role = 'base_pose'
    } else role = 'body_keypoint'
    const s = seg(f, stream === 'other' ? 'meta' : stream, role, 0, f.dim, {
      side: sideOf(childTk) ?? side,
      entity,
      pose: pose ?? undefined,
      confidence: pose ? 0.9 : 0.6,
      evidence: [pk ? `pose key "${pk.child}" → "${pk.parent}"` : 'key mentions extrinsics', pose?.rot ? `rotation ${pose.rot.repr} from ${f.names ? 'names' : 'dimension'}` : ''].filter(Boolean),
    })
    if (role === 'camera_extrinsics' && s.stream === 'observation') s.stream = 'meta'
    return [s]
  }

  // explicit delta actions (OpenX / RT-1 style)
  if (has(tk, 'world') && has(tk, 'vector')) return [seg(f, stream, 'delta_position', 0, f.dim, { actionType: 'delta', pose: { pos: [0, 1, 2], rot: null }, confidence: 0.85, evidence: ['RT-1 style world_vector = EEF translation delta'] })]
  if (has(tk, 'rotation', 'rot') && has(tk, 'delta')) return [seg(f, stream, 'delta_rotation', 0, f.dim, { actionType: 'delta', confidence: 0.85, evidence: ['key mentions rotation delta'] })]
  if (has(tk, 'delta') && has(tk, 'pos', 'position', 'translation', 'xyz'))
    return [seg(f, stream, 'delta_position', 0, f.dim, { actionType: 'delta', pose: { pos: [0, 1, 2], rot: null }, confidence: 0.8, evidence: ['key mentions delta position'] })]

  // depth stored as numeric/image features
  if (has(tk, 'depth')) return [seg(f, stream, 'depth', 0, f.dim, { confidence: 0.9, evidence: ['key mentions depth'] })]

  // named sub-structure inside the vector -> split
  const keyKind = keyLevelKind(tk)
  const labels = f.names ? labelDims(f.names) : null
  if (labels && keyKind !== 'generic' && keyKind !== 'eef') {
    // the key already says what this is (head, waist, base velocity, joints …): names only refine sides / grippers
    const strongPose = labels.filter((l) => l.comp?.startsWith('pos.')).length >= 3
    for (const l of labels) if (l.kind === 'generic' || l.kind === 'head' || l.kind === 'torso' || (l.kind === 'pose' && !strongPose)) l.kind = keyKind as DimKind
  }
  const groups = labels ? groupDims(labels) : null

  if (groups && groups.length > 1) {
    return groups.map((g) => {
      const role = roleForGroup(g.label.kind, keyKind, tk)
      const extra: Partial<Segment> = {
        side: g.label.side ?? side,
        entity: g.label.kind,
        confidence: 0.75,
        evidence: [`split by names (${g.label.side ?? ''} ${g.label.kind})`],
      }
      if (role === 'eef_pose' || role === 'eef_position') {
        const pose = poseFromComps(labels!.slice(g.start, g.end).map((l) => l.comp), ctx.declaredQuat)
        if (pose) extra.pose = pose
      }
      if (role === 'gripper') extra.gripper = gripperSpec(f.names!.slice(g.start, g.end).join(' ') + ' ' + rest, statRange(stats, g.start, g.end))
      return seg(f, stream, role, g.start, g.end, extra)
    })
  }

  // single group (or no names)
  const kind: DimKind = groups?.[0]?.label.kind ?? 'generic'
  let role = roleForGroup(kind === 'generic' ? keyKind : kind, keyKind, tk)
  const extra: Partial<Segment> = { side: groups?.[0]?.label.side ?? side, confidence: kind === 'generic' && keyKind === 'generic' ? 0.3 : 0.8, evidence: [] }
  if (role === 'eef_pose' || role === 'eef_position' || (role === 'gripper' && f.dim >= 6)) {
    const pose = (labels ? poseFromComps(labels.map((l) => l.comp), ctx.declaredQuat) : null) ?? poseFromDim(f.dim, ctx.declaredQuat)
    if (pose) {
      extra.pose = pose
      role = pose.rot ? 'eef_pose' : 'eef_position'
      if (has(tk, ...GRIPPER_WORDS)) extra.entity = 'gripper'
      extra.evidence!.push(`EEF ${pose.rot ? pose.rot.repr : 'position'} from ${labels ? 'names' : 'dimension'}`)
    }
  }
  if (role === 'gripper') extra.gripper = gripperSpec(rest + ' ' + (f.names ?? []).join(' '), statRange(stats, 0, f.dim))
  if (role !== 'unknown' && !extra.evidence!.length) extra.evidence!.push(`key tokens: ${tk.join(' ')}`)
  return [seg(f, stream, role, 0, f.dim, extra)]
}

function keyLevelKind(tk: string[]): DimKind | 'eef' | 'joint_velocity' | 'joint_effort' | 'joint_current' | 'base_velocity' {
  const vel = has(tk, 'velocity', 'vel', 'velocities')
  if (has(tk, ...GRIPPER_WORDS)) return 'gripper'
  if (has(tk, 'hand') && has(tk, 'joint', 'joints')) return 'hand'
  if (has(tk, ...BASE_WORDS) && !has(tk, 'armbase', 'tool')) return vel || has(tk, 'displacement', 'twist', 'cmd') ? 'base_velocity' : 'base'
  if (has(tk, 'robot') && vel) return 'base_velocity'
  if (has(tk, ...EEF_WORDS, 'end') || (has(tk, 'tool') && has(tk, 'pose'))) return 'eef'
  if (has(tk, 'joint', 'joints', 'qpos', 'motor', 'motors')) {
    if (vel) return 'joint_velocity'
    if (has(tk, 'effort', 'torque', 'force')) return 'joint_effort'
    if (has(tk, 'current')) return 'joint_current'
    return 'joint'
  }
  if (has(tk, 'head', 'neck')) return 'head'
  if (has(tk, 'waist', 'torso', 'lift', 'spine')) return 'torso'
  return 'generic'
}

function roleForGroup(kind: string, keyKind: string, tk: string[]): Role {
  switch (kind) {
    case 'gripper':
      return 'gripper'
    case 'hand':
      return 'hand_joints'
    case 'pose':
    case 'eef':
      return 'eef_pose'
    case 'joint':
      if (keyKind === 'joint_velocity' || keyKind === 'joint_effort' || keyKind === 'joint_current') return keyKind as Role
      if (has(tk, 'velocity', 'vel')) return 'joint_velocity'
      if (has(tk, 'effort', 'torque')) return 'joint_effort'
      return 'joint_position'
    case 'joint_velocity':
    case 'joint_effort':
    case 'joint_current':
      return kind as Role
    case 'base':
      return 'base_pose'
    case 'base_velocity':
      return 'base_velocity'
    case 'head':
      return 'head'
    case 'torso':
      return 'torso'
    default:
      return keyKind !== 'generic' && keyKind !== kind ? roleForGroup(keyKind, 'generic', tk) : 'unknown'
  }
}

function gripperSpec(text: string, range: ReturnType<typeof statRange>): Segment['gripper'] {
  const tk = tokenize(text)
  let polarity: 'open_high' | 'closed_high' | 'unknown' = 'unknown'
  if (has(tk, 'closedness', 'closed', 'close', 'closing')) polarity = 'closed_high'
  else if (has(tk, 'openness', 'open', 'opening', 'width', 'aperture')) polarity = 'open_high'
  else if (has(tk, 'position', 'pos')) polarity = 'open_high'
  const r: [number, number] | undefined = range ? [Math.min(...range.min), Math.max(...range.max)] : undefined
  return { polarity, range: r }
}

// ----------------------------------------------------------------------------- stats refinement

/** Value-based fallbacks for unnamed / generically named vectors (e.g. DROID "motor_0..6"). */
function refineWithStats(s: Segment, ds: LeRobotDataset): Segment[] {
  const st = statRange(ds.stats?.[s.feature], s.start, s.end)
  if (!st) return [s]
  const n = s.end - s.start
  if (s.role === 'unknown' || (s.role === 'joint_position' && s.names.every((x) => /^(motor|joint|dim|j)?_?\d+$/.test(x)))) {
    const spans = st.min.map((m, i) => st.max[i] - m)
    const inUnit = (i: number) => st.min[i] >= -1e-6 && st.max[i] <= 1 + 1e-6
    const angleLike = (i: number) => st.min[i] >= -Math.PI - 0.05 && st.max[i] <= Math.PI + 0.05
    const posLike = (i: number) => Math.abs(st.min[i]) < 3 && Math.abs(st.max[i]) < 3 && spans[i] < 2.5
    const wraps = (i: number) => st.max[i] > 2.8 || st.min[i] < -2.8
    // xyz + euler(+gripper): positions inside a ~2 m box and euler angles that wrap around ±pi
    if ((n === 6 || n === 7) && [0, 1, 2].every(posLike) && [3, 4, 5].every(angleLike) && [3, 4, 5].some(wraps) && (n === 6 || inUnit(6))) {
      const pose: PoseSpec = { pos: [0, 1, 2], rot: { repr: 'euler_xyz', idx: [3, 4, 5], ambiguous: true, alternatives: ['euler_xyz', 'rotvec', 'euler_XYZ', 'euler_zyx'] } }
      const out: Segment[] = [
        { ...s, id: n === 7 ? `${s.feature}[${s.start}:${s.start + 6}]` : s.id, end: s.start + 6, names: s.names.slice(0, 6), role: 'eef_pose', pose, confidence: 0.55, evidence: ['value ranges look like xyz (m) + euler angles wrapping at ±π'] },
      ]
      if (n === 7)
        out.push({ ...s, id: `${s.feature}[${s.start + 6}:${s.end}]`, start: s.start + 6, names: s.names.slice(6), role: 'gripper', gripper: { polarity: 'unknown', range: [st.min[6], st.max[6]] }, confidence: 0.5, evidence: ['last dim in [0, 1] → likely gripper'] })
      return out
    }
    if (s.stream === 'action' && st.min.every((m) => m >= -1.001) && st.max.every((m) => m <= 1.001) && st.mean && st.mean.every((m) => Math.abs(m) < 0.65)) {
      return [{ ...s, actionType: 'velocity', confidence: 0.4, evidence: [...s.evidence, 'all dims normalised to [-1, 1] with ~zero mean → normalised velocity / delta command'] }]
    }
  }
  return [s]
}

function inferUnits(s: Segment, ds: LeRobotDataset): void {
  const st = statRange(ds.stats?.[s.feature], s.start, s.end)
  const declared = ds.info?.convention?.units as Record<string, string> | undefined
  const nameUnits = s.names.join(' ')
  const units: Segment['units'] = {}
  if (/_deg\b|degree/.test(nameUnits)) units.angle = 'deg'
  else if (/_rad\b|radian/.test(nameUnits)) units.angle = 'rad'
  if (/_mm\b/.test(nameUnits)) units.length = 'mm'
  else if (/_m\b|meter/.test(nameUnits)) units.length = 'm'
  if (st) {
    const absMax = (idx: number[]) => Math.max(...idx.map((i) => Math.max(Math.abs(st.min[i]), Math.abs(st.max[i]))))
    if (s.pose?.pos && !units.length) {
      const m = absMax(s.pose.pos)
      units.length = m > 50 ? 'mm' : m > 8 ? 'cm' : 'm'
    }
    const angIdx = s.pose?.rot && s.pose.rot.repr.startsWith('euler') ? s.pose.rot.idx : s.role === 'joint_position' || s.role === 'head' ? s.names.map((_, i) => i) : []
    if (angIdx.length && !units.angle) {
      const m = absMax(angIdx)
      units.angle = m > 2 * Math.PI + 0.3 ? (m <= 100.5 && s.role === 'joint_position' ? 'normalized' : 'deg') : 'rad'
    }
  }
  if (declared && !units.length && s.pose?.pos) units.length = declared.length as any
  if (declared && !units.angle && (s.pose?.rot || s.role === 'joint_position')) units.angle = declared.angle as any
  if (Object.keys(units).length) s.units = units
}

// ----------------------------------------------------------------------------- pairing & action type

function strip(feature: string) {
  return splitStream(feature).rest
}

function pairActions(segments: Segment[], ds: LeRobotDataset) {
  const obs = segments.filter((s) => s.stream === 'observation')
  for (const a of segments.filter((s) => s.stream === 'action' || s.stream === 'teleop')) {
    const n = a.end - a.start
    const cands = obs.filter((o) => o.end - o.start === n && (o.role === a.role || (a.role === 'unknown' && o.role !== 'body_keypoint')) && o.side === a.side)
    const score = (o: Segment) =>
      (strip(o.feature) === strip(a.feature) ? 4 : 0) + (o.start === a.start ? 1 : 0) + (o.names.join() === a.names.join() ? 2 : 0) + (o.entity === a.entity ? 1 : 0)
    cands.sort((x, y) => score(y) - score(x))
    const o = cands[0]
    if (o) a.pairedWith = o.id
    if (a.actionType) continue
    const tk = tokenize(a.feature + ' ' + a.names.join(' '))
    if (has(tk, 'delta', 'diff', 'relative', 'rel')) a.actionType = 'delta'
    else if (has(tk, 'velocity', 'vel', 'twist', 'speed')) a.actionType = 'velocity'
    else if (o) {
      const sa = statRange(ds.stats?.[a.feature], a.start, a.end)
      const so = statRange(ds.stats?.[o.feature], o.start, o.end)
      if (a.role === 'gripper') {
        a.actionType = 'absolute'
        if (sa && so) {
          const ra = Math.max(...sa.max) - Math.min(...sa.min)
          const ro = Math.max(...so.max) - Math.min(...so.min)
          if (ro > 0 && (ra / ro > 3 || ro / ra > 3))
            a.evidence.push(`gripper command range ${ra.toPrecision(3)} vs state range ${ro.toPrecision(3)} — different scales / units`)
        }
      } else if (sa && so && sa.mean && so.mean) {
        let close = 0
        for (let i = 0; i < n; i++) {
          const span = Math.max(1e-6, so.max[i] - so.min[i])
          if (Math.abs(sa.mean[i] - so.mean[i]) < 0.25 * span) close++
        }
        a.actionType = close >= n * 0.6 ? 'absolute' : 'delta'
        a.evidence.push(`action/state means ${close}/${n} dims overlap → ${a.actionType}`)
      } else a.actionType = 'absolute'
    } else a.actionType = 'unknown'
  }
}

// ----------------------------------------------------------------------------- cameras & frames

function cameraModels(ds: LeRobotDataset, segments: Segment[]): CameraModel[] {
  const conv = String(ds.info?.convention?.camera ?? '').toLowerCase()
  return ds.features
    .filter((f) => f.isVideo || f.isImage)
    .map((f) => {
      const name = f.key.replace(/^observations?\.(images?|rgb|cameras?|depth)\.?/, '').replace(/^images?\.(rgb\.|depth\.)?/, '') || 'main'
      const nt = tokenize(name).filter((t) => !['rgb', 'image', 'images', 'cam', 'camera', 'color'].includes(t))
      if (!nt.length) nt.push('main')
      const depthKey = has(tokenize(f.key), 'depth')
      const match = (s: Segment) => {
        const et = tokenize(s.entity ?? '')
        return et.length > 0 && et.join('_') === nt.join('_')
      }
      const loose = (s: Segment) => {
        const et = tokenize(s.entity ?? '')
        return et.length > 0 && et.every((t) => nt.includes(t))
      }
      const intr = segments.find((s) => s.role === 'camera_intrinsics' && match(s)) ?? segments.find((s) => s.role === 'camera_intrinsics' && loose(s))
      const extr = segments.find((s) => s.role === 'camera_extrinsics' && match(s)) ?? segments.find((s) => s.role === 'camera_extrinsics' && loose(s))
      const dist = segments.find((s) => s.role === 'camera_distortion' && match(s))
      const info = (f.info ?? {}) as Record<string, any>
      const robotHuman = ds.robotType.toLowerCase().includes('human')
      const mount: CameraModel['mount'] = robotHuman
        ? 'egocentric'
        : has(nt, 'wrist', 'hand', 'gripper', 'arm', 'eih')
          ? 'wrist'
          : has(nt, 'head', 'ego', 'chest')
            ? 'head'
            : has(nt, 'front', 'side', 'third', 'exterior', 'external', 'top', 'up', 'high', 'low', 'overhead', 'scene', 'global', 'view', 'agentview', 'base')
              ? 'third_person'
              : 'unknown'
      const intrDim = intr ? intr.end - intr.start : 0
      return {
        key: f.key,
        name: nt.join('_') + (depthKey && !nt.includes('depth') ? '_depth' : ''),
        height: Number(info['video.height'] ?? f.shape[0]) || undefined,
        width: Number(info['video.width'] ?? f.shape[1]) || undefined,
        fps: Number(info['video.fps'] ?? ds.fps) || undefined,
        codec: info['video.codec'] ? String(info['video.codec']) : undefined,
        pixFmt: info['video.pix_fmt'] ? String(info['video.pix_fmt']) : undefined,
        isDepth: Boolean(info['video.is_depth_map']) || depthKey,
        intrinsics: intr ? { feature: intr.feature, layout: intrDim === 9 ? 'matrix3x3' : 'fx_fy_cx_cy' } : undefined,
        distortion: dist?.feature,
        extrinsics: extr ? { segment: extr.id, parent: extr.pose?.parent } : undefined,
        mount,
        convention: conv.includes('opencv') ? 'opencv' : conv.includes('opengl') ? 'opengl' : conv.includes('ros') ? 'ros_body' : 'unknown',
      }
    })
}

function frameEdges(segments: Segment[]): FrameEdge[] {
  const edges: FrameEdge[] = []
  const keypointParents = new Map<string, number>()
  for (const s of segments) {
    if (!s.pose) continue
    if (s.role === 'body_keypoint') {
      const p = s.pose.parent ?? 'world'
      if (s.stream === 'observation') keypointParents.set(p, (keypointParents.get(p) ?? 0) + 1)
      continue
    }
    if (s.stream === 'action' || s.stream === 'teleop') continue
    if (s.role === 'eef_pose' || s.role === 'eef_position' || s.role === 'camera_extrinsics' || s.role === 'base_pose') {
      const child = s.pose.child ?? (s.role === 'eef_pose' || s.role === 'eef_position' ? `${s.side ? s.side + '_' : ''}${s.entity === 'gripper' ? 'gripper' : 'eef'}` : s.entity ?? s.feature)
      const parent = s.pose.parent ?? (s.role === 'base_pose' ? 'world' : 'base (implicit)')
      if (!edges.some((e) => e.child === child && e.parent === parent)) edges.push({ child, parent, segment: s.id })
    }
  }
  for (const [p, n] of keypointParents) edges.push({ child: `${n} body/hand keypoints`, parent: p, segment: '' })
  return edges
}

function embodimentOf(ds: LeRobotDataset, segs: Segment[]): { e: Embodiment; ev: string[]; ee: DatasetSemantics['endEffector']; mobile?: boolean } {
  const ev: string[] = []
  const rt = ds.robotType.toLowerCase()
  const kp = segs.filter((s) => s.role === 'body_keypoint').length
  if (rt.includes('human') || kp > 10) {
    ev.push(rt.includes('human') ? `robot_type "${ds.robotType}"` : `${kp} body keypoint poses`)
    return { e: 'human_hand', ev, ee: 'human_hand' }
  }
  const armRoles = new Set<Role>(['joint_position', 'eef_pose', 'eef_position', 'gripper', 'hand_joints'])
  const sides = new Set(segs.filter((s) => armRoles.has(s.role) && s.side).map((s) => s.side))
  const hasHand = segs.some((s) => s.role === 'hand_joints')
  const hasGripper = segs.some((s) => s.role === 'gripper')
  // a base pose that differs between episodes but is constant inside each one is a fixed (re-placed) base
  const moves = (s: Segment) => {
    const per = ds.episodes.map((e) => e.stats?.[s.feature]).filter(Boolean) as FeatureStats[]
    const ranges = per.length ? per.map((p) => statRange(p, s.start, s.end)) : [statRange(ds.stats?.[s.feature], s.start, s.end)]
    if (!ranges[0]) return true
    return ranges.some((st) => {
      if (!st) return false
      const idx = s.pose?.pos ?? st.min.map((_, i) => i)
      return idx.some((i) => st.max[i] - st.min[i] > 1e-3)
    })
  }
  const mobile = segs.some((s) => (s.role === 'base_pose' || s.role === 'base_velocity') && moves(s))
  const head = segs.some((s) => s.role === 'head')
  const torso = segs.some((s) => s.role === 'torso')
  const ee: DatasetSemantics['endEffector'] = hasHand ? 'dexterous_hand' : hasGripper ? 'parallel_gripper' : 'unknown'
  if (segs.some((s) => s.role === 'position_2d')) return { e: 'planar', ev: ['2D position state'], ee: 'none' }
  const dual = sides.has('left') && sides.has('right')
  if (dual) ev.push('left and right arm signals')
  if (mobile) ev.push('mobile base pose / velocity')
  if (head) ev.push('head joints')
  if (torso) ev.push('waist / torso joints')
  if (hasHand) ev.push('dexterous hand joints')
  if (dual && head && torso) return { e: 'humanoid', ev, ee, mobile }
  if (mobile) return { e: 'mobile_manipulator', ev, ee, mobile }
  if (dual) return { e: 'dual_arm', ev, ee, mobile }
  if (hasHand) return { e: 'dexterous_hand', ev, ee, mobile }
  if (segs.some((s) => armRoles.has(s.role))) return { e: 'single_arm', ev: ['single arm signals', ...ev], ee, mobile }
  return { e: 'unknown', ev, ee, mobile }
}

// ----------------------------------------------------------------------------- entry point

export function inferSemantics(ds: LeRobotDataset): DatasetSemantics {
  segCounter = 0
  const declaredQuat = ds.info?.convention?.quaternion ? String(ds.info.convention.quaternion).toLowerCase() : undefined
  const ctx: Ctx = { ds, declaredQuat, vocabNames: ds.extras.vocabularies.map((v) => v.name) }
  let segments: Segment[] = []
  for (const f of ds.features) {
    if (f.isVideo || f.isImage) {
      segments.push({
        id: f.key,
        feature: f.key,
        start: 0,
        end: 0,
        names: [],
        stream: 'observation',
        role: has(tokenize(f.key), 'depth') ? 'depth' : 'camera',
        entity: f.key.split('.').pop(),
        confidence: 1,
        evidence: [`dtype ${f.dtype}`],
      })
      continue
    }
    for (const s of classifyFeature(f, ctx)) segments.push(...refineWithStats(s, ds))
  }
  for (const s of segments) inferUnits(s, ds)
  segments = applyProfiles(ds, segments)
  pairActions(segments, ds)

  const cameras = cameraModels(ds, segments)
  const { e, ev, ee, mobile } = embodimentOf(ds, segments)
  const rotations = [...new Set(segments.filter((s) => s.pose?.rot && s.role !== 'camera_extrinsics').map((s) => s.pose!.rot!.repr))]
  const quats = new Set(segments.filter((s) => s.pose?.rot?.repr.startsWith('quat')).map((s) => s.pose!.rot!.repr.slice(5)))
  const primaryRoles = new Set<Role>(['joint_position', 'gripper', 'eef_pose', 'eef_position', 'hand_joints', 'position_2d', 'delta_position', 'delta_rotation', 'base_velocity', 'head', 'torso', 'unknown'])
  const primary = (stream: Stream) => segments.filter((s) => s.stream === stream && primaryRoles.has(s.role)).map((s) => s.id)
  const notes: string[] = []
  const ambiguous = segments.filter((s) => s.pose?.rot?.ambiguous)
  if (ambiguous.length) notes.push(`${ambiguous.length} rotation(s) have an ambiguous representation — verify in the Schema tab (${[...new Set(ambiguous.map((s) => s.feature))].slice(0, 4).join(', ')})`)
  const unknown = segments.filter((s) => s.role === 'unknown')
  if (unknown.length) notes.push(`${unknown.length} segment(s) could not be interpreted: ${unknown.map((s) => s.id).slice(0, 4).join(', ')}`)

  return {
    segments,
    cameras,
    embodiment: e,
    embodimentEvidence: ev,
    mobileBase: Boolean(mobile),
    endEffector: ee,
    frames: frameEdges(segments),
    primaryState: primary('observation'),
    primaryAction: [...primary('action')],
    conventions: {
      quaternion: quats.size === 0 ? 'none' : quats.size > 1 ? 'mixed' : ([...quats][0] as 'xyzw' | 'wxyz'),
      rotations,
      cameraConvention: ds.info?.convention?.camera,
      declaredUnits: ds.info?.convention?.units,
      source: ds.info?.convention ? 'declared' : 'inferred',
    },
    notes,
  }
}
