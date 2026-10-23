import type { LeRobotDataset } from '@core/lerobot/types'
import type { DatasetSemantics, Segment } from '@core/semantics/types'

/**
 * User / LLM corrections to inferred semantics, persisted per dataset *schema signature*
 * (so every dataset sharing the same features benefits) and exportable as "embodispec" JSON.
 */
export interface SegmentOverride {
  id: string
  role?: Segment['role']
  side?: Segment['side'] | null
  rotation?: string | null
  units?: Segment['units']
  gripperPolarity?: 'open_high' | 'closed_high' | 'unknown'
  actionType?: Segment['actionType']
  source: 'user' | 'llm'
}

export interface EmbodiSpec {
  format: 'embodiscope.spec/v1'
  signature: string
  dataset: string
  robot_type: string
  fps: number
  embodiment: string
  segments: {
    id: string
    feature: string
    slice: [number, number]
    stream: string
    role: string
    side?: string
    names: string[]
    rotation?: { repr: string; idx: number[] } | null
    position_idx?: number[] | null
    frame?: { child?: string; parent?: string }
    units?: Segment['units']
    gripper?: Segment['gripper']
    action_type?: string
    paired_with?: string
  }[]
  cameras: DatasetSemantics['cameras']
}

export function schemaSignature(ds: LeRobotDataset): string {
  const s = ds.features.map((f) => `${f.key}:${f.dtype}:${f.shape.join('x')}`).join('|')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return `${ds.robotType}-${(h >>> 0).toString(16)}`
}

const KEY = (sig: string) => `embodiscope.overrides.${sig}`

export function saveOverride(ds: LeRobotDataset, o: SegmentOverride) {
  const sig = schemaSignature(ds)
  const all: SegmentOverride[] = JSON.parse(localStorage.getItem(KEY(sig)) ?? '[]')
  const i = all.findIndex((x) => x.id === o.id)
  if (i >= 0) all[i] = { ...all[i], ...o }
  else all.push(o)
  localStorage.setItem(KEY(sig), JSON.stringify(all))
}

export function clearOverrides(ds: LeRobotDataset) {
  localStorage.removeItem(KEY(schemaSignature(ds)))
}

export function applyOverride(seg: Segment, o: SegmentOverride) {
  if (o.role) seg.role = o.role
  if (o.side !== undefined) seg.side = o.side ?? undefined
  if (o.rotation !== undefined && seg.pose) {
    if (o.rotation === null) seg.pose.rot = null
    else if (seg.pose.rot) seg.pose.rot = { ...seg.pose.rot, repr: o.rotation as any, ambiguous: false }
  }
  if (o.units) seg.units = { ...seg.units, ...o.units }
  if (o.gripperPolarity) seg.gripper = { ...(seg.gripper ?? { polarity: 'unknown' }), polarity: o.gripperPolarity }
  if (o.actionType) seg.actionType = o.actionType
  seg.overridden = o.source
  seg.confidence = 1
}

export function loadUserOverrides(ds: LeRobotDataset, sem: DatasetSemantics) {
  try {
    const all: SegmentOverride[] = JSON.parse(localStorage.getItem(KEY(schemaSignature(ds))) ?? '[]')
    for (const o of all) {
      const seg = sem.segments.find((s) => s.id === o.id)
      if (seg) applyOverride(seg, o)
    }
  } catch {
    // ignore corrupted overrides
  }
}

export function toSpec(ds: LeRobotDataset, sem: DatasetSemantics): EmbodiSpec {
  return {
    format: 'embodiscope.spec/v1',
    signature: schemaSignature(ds),
    dataset: ds.name,
    robot_type: ds.robotType,
    fps: ds.fps,
    embodiment: sem.embodiment,
    segments: sem.segments
      .filter((s) => s.role !== 'index')
      .map((s) => ({
        id: s.id,
        feature: s.feature,
        slice: [s.start, s.end],
        stream: s.stream,
        role: s.role,
        side: s.side,
        names: s.names,
        rotation: s.pose?.rot ? { repr: s.pose.rot.repr, idx: s.pose.rot.idx.map((i) => i + s.start) } : null,
        position_idx: s.pose?.pos ? s.pose.pos.map((i) => i + s.start) : null,
        frame: s.pose ? { child: s.pose.child, parent: s.pose.parent } : undefined,
        units: s.units,
        gripper: s.gripper,
        action_type: s.actionType,
        paired_with: s.pairedWith,
      })),
    cameras: sem.cameras,
  }
}
