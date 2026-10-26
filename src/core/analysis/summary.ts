import type { LeRobotDataset } from '../lerobot/types'
import type { RotationRepr } from '../math/rotation'
import { summarize } from '../math/stats'
import type { Summary } from '../math/stats'
import type { DatasetSemantics, Role } from '../semantics/types'
import { tokenize } from '../semantics/tokens'

export type AnnotationLevel =
  | 'task'
  | 'episode_instruction'
  | 'subtask_segments'
  | 'skill_labels'
  | 'frame_primitives'
  | 'scene_description'
  | 'quality_flags'

export interface SubtaskSegment {
  start: number
  end: number
  text: string
  skill?: string
  caption?: string
  source: string
}

export interface AnnotationProfile {
  levels: AnnotationLevel[]
  /** 0 … 5, see docs */
  granularityScore: number
  numTasks: number
  uniqueInstructions: number
  instructionWords: Summary
  vocabularySize: number
  /** average number of subtask segments per episode (when segments exist) */
  subtasksPerEpisode?: number
  sources: string[]
}

export interface CameraCard {
  name: string
  resolution: string
  codec: string
  mount: string
  depth: boolean
  calibrated: boolean
}

/** A flat, comparable description of a dataset (Overview + Compare tabs, exports). */
export interface DatasetCard {
  id: string
  name: string
  version: string
  robotType: string
  embodiment: string
  endEffector: string
  mobileBase: boolean
  fps: number
  episodes: number
  availableEpisodes: number
  frames: number
  hours: number
  episodeSeconds: Summary
  cameras: CameraCard[]
  stateDim: number
  actionDim: number
  stateComposition: string
  actionComposition: string
  actionSpace: string
  actionType: string
  rotationReprs: RotationRepr[]
  quaternionOrder: string
  referenceFrames: string[]
  lengthUnits: string
  angleUnits: string
  gripperPolarity: string
  hasIntrinsics: boolean
  hasExtrinsics: boolean
  hasDepth: boolean
  annotation: AnnotationProfile
  conventionDeclared: boolean
  sizeBytes?: number
  warnings: number
}

const ROLE_SHORT: Partial<Record<Role, string>> = {
  joint_position: 'joint',
  joint_velocity: 'joint_vel',
  joint_effort: 'effort',
  joint_current: 'current',
  gripper: 'gripper',
  hand_joints: 'hand',
  eef_pose: 'eef_pose',
  eef_position: 'eef_xyz',
  delta_position: 'Δxyz',
  delta_rotation: 'Δrot',
  base_pose: 'base_pose',
  base_velocity: 'base_vel',
  head: 'head',
  torso: 'torso',
  position_2d: 'xy',
  body_keypoint: 'keypoints',
  unknown: '?',
}

export function composition(sem: DatasetSemantics, stream: 'observation' | 'action'): { dim: number; text: string } {
  const segs = sem.segments.filter((s) => s.stream === stream && s.end > s.start && ROLE_SHORT[s.role])
  const parts = new Map<string, number>()
  for (const s of segs) {
    const short = s.role === 'joint_position' && /leg/.test(s.entity ?? '') ? 'leg' : ROLE_SHORT[s.role]
    const k = `${s.side ? s.side[0].toUpperCase() + '·' : ''}${short}`
    parts.set(k, (parts.get(k) ?? 0) + (s.end - s.start))
  }
  const dim = segs.reduce((a, s) => a + s.end - s.start, 0)
  return { dim, text: [...parts].map(([k, n]) => `${k}(${n})`).join(' + ') }
}

/** Subtask segments embedded in metadata: AgiBot `action_config`, RoboCoIN per-frame subtask ids, generic `subtasks`. */
export function metadataSubtasks(ds: LeRobotDataset, episodeIndex: number): SubtaskSegment[] {
  const ep = ds.episodes.find((e) => e.index === episodeIndex)
  if (!ep) return []
  const out: SubtaskSegment[] = []
  const cfg = (ep.extra.action_config ?? ep.extra.subtasks ?? ep.extra.segments) as any
  if (Array.isArray(cfg)) {
    for (const c of cfg) {
      const start = Number(c.start_frame ?? c.start ?? c.from ?? 0)
      const end = Number(c.end_frame ?? c.end ?? c.to ?? start)
      const text = String(c.action_text ?? c.text ?? c.subtask ?? c.description ?? '')
      out.push({ start, end, text, skill: c.skill ? String(c.skill) : undefined, source: 'metadata' })
    }
  }
  return out
}

export function annotationProfile(ds: LeRobotDataset, sem: DatasetSemantics): AnnotationProfile {
  const levels = new Set<AnnotationLevel>()
  const sources: string[] = []
  const texts = ds.tasks.map((t) => t.text).filter(Boolean)
  const episodeTexts = ds.episodes.flatMap((e) => e.tasks)
  const all = texts.length ? texts : episodeTexts
  if (all.length) levels.add('task')
  const unique = new Set(episodeTexts.length ? episodeTexts : texts)
  if (unique.size > 1) levels.add('episode_instruction')
  const words = [...unique].map((t) => tokenize(t).length)
  const vocab = new Set([...unique].flatMap((t) => tokenize(t)))

  let subtaskEpisodes = 0, subtaskCount = 0
  for (const e of ds.episodes) {
    const segs = metadataSubtasks(ds, e.index)
    if (segs.length) {
      subtaskEpisodes++
      subtaskCount += segs.length
      if (segs.some((s) => s.skill)) levels.add('skill_labels')
    }
  }
  if (subtaskEpisodes) {
    levels.add('subtask_segments')
    sources.push('episodes metadata (action_config / subtasks)')
  }
  const labelSegs = sem.segments.filter((s) => s.role === 'label')
  for (const l of labelSegs) {
    const t = tokenize(l.feature)
    if (t.includes('subtask')) {
      levels.add('subtask_segments')
      sources.push(`frame column ${l.feature}`)
    } else if (t.includes('scene')) {
      levels.add('scene_description')
      sources.push(`frame column ${l.feature}`)
    } else {
      levels.add('frame_primitives')
      sources.push(`frame column ${l.feature}`)
    }
  }
  if (ds.extras.vocabularies.some((v) => v.name === 'scene')) levels.add('scene_description')
  if (ds.episodes.some((e) => Object.keys(e.extra).some((k) => /confidence|quality|success|score/.test(k)))) levels.add('quality_flags')
  if (all.some((t) => t.includes('|'))) levels.add('scene_description')

  const score =
    (levels.has('task') ? 1 : 0) +
    (levels.has('episode_instruction') ? 1 : 0) +
    (levels.has('subtask_segments') ? 1.5 : 0) +
    (levels.has('skill_labels') || levels.has('frame_primitives') ? 1 : 0) +
    (levels.has('scene_description') ? 0.5 : 0)
  return {
    levels: [...levels],
    granularityScore: Math.min(5, score),
    numTasks: ds.tasks.length || unique.size,
    uniqueInstructions: unique.size,
    instructionWords: summarize(words),
    vocabularySize: vocab.size,
    subtasksPerEpisode: subtaskEpisodes ? subtaskCount / subtaskEpisodes : undefined,
    sources: [...new Set(sources)],
  }
}

export function datasetCard(ds: LeRobotDataset, sem: DatasetSemantics): DatasetCard {
  const fps = ds.fps || 30
  const lengths = ds.episodes.map((e) => e.length).filter((l) => l > 0)
  const frames = lengths.reduce((a, b) => a + b, 0) || Number(ds.info.total_frames ?? 0)
  const st = composition(sem, 'observation')
  const ac = composition(sem, 'action')
  const actSegs = sem.segments.filter((s) => s.stream === 'action' && s.end > s.start && s.role !== 'label' && s.role !== 'done')
  const roles = new Set(actSegs.map((s) => s.role))
  const space =
    roles.has('position_2d')
      ? '2D position'
      : roles.has('delta_position') || roles.has('delta_rotation')
        ? 'EEF delta / velocity'
        : roles.has('joint_position') && roles.has('eef_pose')
          ? 'joint + EEF pose'
          : roles.has('eef_pose') || roles.has('eef_position')
            ? 'EEF pose'
            : roles.has('joint_position') || roles.has('hand_joints')
              ? 'joint position'
              : roles.has('unknown')
                ? 'unknown'
                : [...roles].join(' + ') || 'none'
  const types = new Set(actSegs.map((s) => s.actionType ?? 'unknown'))
  const poseSegs = sem.segments.filter((s) => s.pose?.pos && s.units?.length)
  const angSegs = sem.segments.filter((s) => s.units?.angle)
  const grippers = sem.segments.filter((s) => s.role === 'gripper' && s.stream === 'observation')
  const frames3 = [...new Set(sem.frames.map((f) => f.parent))]
  return {
    id: ds.id,
    name: ds.name,
    version: ds.version,
    robotType: ds.robotType,
    embodiment: sem.embodiment,
    endEffector: sem.endEffector,
    mobileBase: sem.mobileBase,
    fps,
    episodes: ds.episodes.length,
    availableEpisodes: ds.episodes.filter((e) => e.available).length,
    frames,
    hours: frames / fps / 3600,
    episodeSeconds: summarize(lengths.map((l) => l / fps)),
    cameras: sem.cameras.map((c) => ({
      name: c.name,
      resolution: c.width && c.height ? `${c.width}×${c.height}` : '?',
      codec: c.codec ?? '?',
      mount: c.mount,
      depth: Boolean(c.isDepth),
      calibrated: Boolean(c.intrinsics),
    })),
    stateDim: st.dim,
    actionDim: ac.dim,
    stateComposition: st.text,
    actionComposition: ac.text,
    actionSpace: space,
    actionType: [...types].join(' / '),
    rotationReprs: sem.conventions.rotations,
    quaternionOrder: sem.conventions.quaternion ?? 'none',
    referenceFrames: frames3,
    lengthUnits: [...new Set(poseSegs.map((s) => s.units!.length))].join(' / ') || '—',
    angleUnits: [...new Set(angSegs.map((s) => s.units!.angle))].join(' / ') || '—',
    gripperPolarity: [...new Set(grippers.map((g) => g.gripper?.polarity ?? 'unknown'))].join(' / ') || '—',
    hasIntrinsics: sem.cameras.some((c) => c.intrinsics),
    hasExtrinsics: sem.cameras.some((c) => c.extrinsics),
    hasDepth: sem.cameras.some((c) => c.isDepth) || sem.segments.some((s) => s.role === 'depth'),
    annotation: annotationProfile(ds, sem),
    conventionDeclared: Boolean(ds.info.convention),
    sizeBytes: ds.totalBytes,
    warnings: ds.warnings.length,
  }
}
