import type { FrameTable } from '../data/frameTable'
import type { LeRobotDataset } from '../lerobot/types'
import type { DatasetSemantics } from '../semantics/types'
import type { ChatMessage, ChatPart } from './llm'
import type { SubtaskSegment } from '../analysis/summary'

const r = (x: number) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null)
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + ' …' : s)

/** Compact, token-efficient description of a dataset for LLM prompts. */
export function datasetContext(ds: LeRobotDataset, sem: DatasetSemantics, sample?: FrameTable): string {
  const { features: _f, stats: _s, ...infoRest } = ds.info
  void _f
  void _s
  const feats = ds.features.map((f) => {
    const st = ds.stats?.[f.key]
    const o: Record<string, unknown> = { key: f.key, dtype: f.dtype, shape: f.shape }
    if (f.names) o.names = f.names.length > 24 ? [...f.names.slice(0, 24), `… (${f.names.length})`] : f.names
    else if (f.rawNames && !f.isVideo) o.names = f.rawNames
    if (f.info && f.isVideo) o.video = f.info
    if (st?.min && !f.isVideo && !f.isImage) {
      const n = Math.min(st.min.length, 16)
      o.min = st.min.slice(0, n).map(r)
      o.max = st.max?.slice(0, n).map(r)
      o.mean = st.mean?.slice(0, n).map(r)
    }
    if (sample && sample.has(f.key)) o.first_frame = sample.vector(f.key, 0).slice(0, 16).map(r)
    return o
  })
  const inferred = sem.segments
    .filter((s) => s.role !== 'index' && s.role !== 'body_keypoint')
    .map((s) => ({ id: s.id, stream: s.stream, role: s.role, side: s.side, rotation: s.pose?.rot?.repr, frame: s.pose?.parent, units: s.units, action_type: s.actionType }))
  const ep0 = ds.episodes[0]
  const docs = ds.extras.documents.map((d) => `--- ${d.path}\n${clip(d.text, 1500)}`).join('\n')
  return [
    `# info.json (without features)\n${JSON.stringify(infoRest)}`,
    `# features\n${JSON.stringify(feats)}`,
    `# heuristic interpretation by EmbodiScope (may be wrong)\n${JSON.stringify({ embodiment: sem.embodiment, end_effector: sem.endEffector, frames: sem.frames, segments: inferred })}`,
    `# tasks (first 10 of ${ds.tasks.length})\n${JSON.stringify(ds.tasks.slice(0, 10).map((t) => t.text))}`,
    ep0 ? `# first episode metadata\n${clip(JSON.stringify({ index: ep0.index, length: ep0.length, tasks: ep0.tasks, ...ep0.extra }), 2500)}` : '',
    ds.extras.vocabularies.length ? `# label vocabularies\n${JSON.stringify(ds.extras.vocabularies.map((v) => ({ name: v.name, labels: [...v.labels.values()].slice(0, 12) })))}` : '',
    docs ? `# sidecar documents\n${docs}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export interface FormatAnalysis {
  summary: string
  embodiment?: string
  features: {
    key: string
    slice?: string | null
    role: string
    side?: string | null
    meaning: string
    reference_frame?: string | null
    rotation?: string | null
    units?: string | null
    confidence?: number
  }[]
  coordinate_frames?: { name: string; description: string }[]
  action_semantics?: string
  annotation_granularity?: string
  issues?: string[]
  training_recommendations?: string[]
}

export const ROLE_LIST =
  'joint_position, joint_velocity, joint_effort, joint_current, gripper, hand_joints, eef_pose, eef_position, delta_position, delta_rotation, body_keypoint, camera_intrinsics, camera_extrinsics, camera_distortion, base_pose, base_velocity, head, torso, position_2d, label, confidence, reward, done, index, unknown'
export const ROTATION_LIST = 'quat_xyzw, quat_wxyz, euler_xyz (extrinsic roll-pitch-yaw), euler_zyx, euler_XYZ (intrinsic), euler_ZYX, rotvec, rot6d, matrix'

export function formatAnalysisMessages(context: string, lang: 'zh' | 'en'): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You are an expert in robot learning datasets (LeRobot, Open X-Embodiment, DROID, AgiBot World, RoboMIND, EgoDex …). ' +
        'You analyse dataset schemas and explain precisely what every signal means, which coordinate frame it is expressed in, the rotation representation, units, and how actions relate to states. ' +
        'Be concrete and skeptical: when names are ambiguous say so and use value ranges as evidence. Reply with JSON only.',
    },
    {
      role: 'user',
      content:
        `${context}\n\n` +
        `Return a JSON object with keys:\n` +
        `summary (string), embodiment (string), features (array of {key, slice ("[a:b]" for part of a vector or null), role (one of: ${ROLE_LIST}), side ("left"|"right"|null), meaning, reference_frame, rotation (one of: ${ROTATION_LIST} or null), units, confidence 0-1}), ` +
        `coordinate_frames (array of {name, description}), action_semantics (string: absolute/delta/velocity, joint/eef space, relation to state), annotation_granularity (string), issues (array of strings), training_recommendations (array of strings).\n` +
        `Cover every non-index feature; split concatenated vectors into slices. Write all natural-language values in ${lang === 'zh' ? 'Simplified Chinese' : 'English'}.`,
    },
  ]
}

export interface SubtaskResult {
  segments: { start_frame: number; end_frame: number; subtask: string; skill?: string; caption?: string }[]
  episode_caption?: string
  scene?: string
  success?: boolean | null
}

export interface FrameSample {
  frame: number
  time: number
  dataUrl: string
  camera: string
}

export function subtaskMessages(args: {
  instruction: string
  fps: number
  length: number
  frames: FrameSample[]
  signals?: string
  existing?: SubtaskSegment[]
  lang: 'zh' | 'en'
  granularity: 'coarse' | 'fine'
}): ChatMessage[] {
  const content: ChatPart[] = [
    {
      type: 'text',
      text:
        `Robot / human manipulation episode. Instruction: "${args.instruction || '(none)'}". ` +
        `${args.length} frames at ${args.fps} fps (${(args.length / args.fps).toFixed(1)} s). ` +
        `Below are ${args.frames.length} sampled frames in temporal order, each preceded by its frame index.` +
        (args.signals ? `\nProprioceptive cues (from the data, reliable timing): ${args.signals}` : '') +
        (args.existing?.length ? `\nExisting segmentation to refine: ${JSON.stringify(args.existing.map((s) => [s.start, s.end, s.text]))}` : ''),
    },
  ]
  for (const f of args.frames) {
    content.push({ type: 'text', text: `frame ${f.frame} (t=${f.time.toFixed(2)}s, ${f.camera})` })
    content.push({ type: 'image', dataUrl: f.dataUrl })
  }
  content.push({
    type: 'text',
    text:
      `Decompose the episode into ${args.granularity === 'fine' ? 'fine-grained atomic actions (reach, grasp, lift, move, place, release, push, open, close, pour …)' : 'meaningful subtasks (3-8 typically)'}. ` +
      `Return JSON: {"segments":[{"start_frame":int,"end_frame":int,"subtask":"imperative sentence naming objects and arm/hand used","skill":"one verb","caption":"what visibly happens"}],"episode_caption":"one or two sentences","scene":"objects and layout","success":true|false|null}. ` +
      `Segments must be contiguous, ordered, cover 0..${args.length} and align boundaries with the sampled frames / proprioceptive cues. ` +
      `Write text in ${args.lang === 'zh' ? 'Simplified Chinese' : 'English'}.`,
  })
  return [
    { role: 'system', content: 'You are a meticulous annotator of robot manipulation videos for training vision-language-action models. Reply with JSON only.' },
    { role: 'user', content },
  ]
}

/** Validate and repair a model segmentation: clamp, sort, make contiguous. */
export function normalizeSegments(res: SubtaskResult, length: number): SubtaskSegment[] {
  const segs = (res.segments ?? [])
    .map((s) => ({
      start: Math.max(0, Math.min(length, Math.round(Number(s.start_frame)))),
      end: Math.max(0, Math.min(length, Math.round(Number(s.end_frame)))),
      text: String(s.subtask ?? s.caption ?? ''),
      skill: s.skill ? String(s.skill) : undefined,
      caption: s.caption ? String(s.caption) : undefined,
      source: 'llm',
    }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start)
  for (let i = 0; i < segs.length; i++) {
    if (i === 0) segs[i].start = 0
    if (i > 0) segs[i].start = segs[i - 1].end
    if (i === segs.length - 1) segs[i].end = length
    if (segs[i].end <= segs[i].start) segs[i].end = Math.min(length, segs[i].start + 1)
  }
  return segs.filter((s) => s.end > s.start)
}
