import type { Mat4, Vec3 } from '../math/rotation'
import { eulerToMat, makeTransform, mul4, rotvecToMat } from '../math/rotation'

/** Kinematic skeleton of a URDF (meshes are ignored: links are drawn as segments between joint origins). */
export interface UrdfJoint {
  name: string
  type: 'revolute' | 'continuous' | 'prismatic' | 'fixed' | 'floating' | 'planar'
  parent: string
  child: string
  xyz: Vec3
  rpy: Vec3
  axis: Vec3
  lower?: number
  upper?: number
  /** <mimic joint="…" multiplier offset> (common for parallel grippers) */
  mimic?: { joint: string; multiplier: number; offset: number }
}

export interface UrdfModel {
  name: string
  links: string[]
  joints: UrdfJoint[]
  root: string
  /** movable joints in depth-first order from the root */
  movable: UrdfJoint[]
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1] ?? tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`))?.[1]
const vec = (s: string | undefined, d: Vec3): Vec3 => {
  if (!s) return d
  const v = s.trim().split(/\s+/).map(Number)
  return v.length === 3 && v.every(Number.isFinite) ? (v as Vec3) : d
}

/** Regex-based URDF reader (no DOM, so it also runs in workers / Node). */
export function parseUrdf(xml: string): UrdfModel {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '')
  const name = attr(text.match(/<robot\b[^>]*>/)?.[0] ?? '', 'name') ?? 'robot'
  const links = [...text.matchAll(/<link\b[^>]*?name\s*=\s*["']([^"']+)["']/g)].map((m) => m[1])
  const joints: UrdfJoint[] = []
  for (const m of text.matchAll(/<joint\b([^>]*)>([\s\S]*?)<\/joint>/g)) {
    const head = m[1]
    const body = m[2]
    const origin = body.match(/<origin\b[^>]*\/?>/)?.[0] ?? ''
    const limit = body.match(/<limit\b[^>]*\/?>/)?.[0] ?? ''
    const mimic = body.match(/<mimic\b[^>]*\/?>/)?.[0]
    const j: UrdfJoint = {
      name: attr(head, 'name') ?? `joint${joints.length}`,
      type: (attr(head, 'type') ?? 'fixed') as UrdfJoint['type'],
      parent: attr(body.match(/<parent\b[^>]*\/?>/)?.[0] ?? '', 'link') ?? '',
      child: attr(body.match(/<child\b[^>]*\/?>/)?.[0] ?? '', 'link') ?? '',
      xyz: vec(attr(origin, 'xyz'), [0, 0, 0]),
      rpy: vec(attr(origin, 'rpy'), [0, 0, 0]),
      axis: vec(attr(body.match(/<axis\b[^>]*\/?>/)?.[0] ?? '', 'xyz'), [1, 0, 0]),
      lower: attr(limit, 'lower') !== undefined ? Number(attr(limit, 'lower')) : undefined,
      upper: attr(limit, 'upper') !== undefined ? Number(attr(limit, 'upper')) : undefined,
    }
    if (mimic) j.mimic = { joint: attr(mimic, 'joint') ?? '', multiplier: Number(attr(mimic, 'multiplier') ?? 1), offset: Number(attr(mimic, 'offset') ?? 0) }
    // <transmission><joint name="…"> blocks reference joints but are not kinematic joints
    if (j.parent && j.child) joints.push(j)
  }
  const children = new Set(joints.map((j) => j.child))
  const root = links.find((l) => !children.has(l)) ?? joints[0]?.parent ?? links[0] ?? 'base'
  const movable: UrdfJoint[] = []
  const visit = (link: string) => {
    for (const j of joints.filter((x) => x.parent === link)) {
      if (j.type !== 'fixed' && !j.mimic) movable.push(j)
      visit(j.child)
    }
  }
  visit(root)
  return { name, links, joints, root, movable }
}

/** World (root) transform of every link for the given joint values. Unknown joints stay at 0. */
export function forwardKinematics(model: UrdfModel, q: Map<string, number>): Map<string, Mat4> {
  const out = new Map<string, Mat4>()
  out.set(model.root, makeTransform([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0]))
  const value = (j: UrdfJoint): number => {
    if (j.mimic) return (q.get(j.mimic.joint) ?? 0) * j.mimic.multiplier + j.mimic.offset
    return q.get(j.name) ?? 0
  }
  const visit = (link: string) => {
    const Tp = out.get(link)!
    for (const j of model.joints.filter((x) => x.parent === link)) {
      const T0 = makeTransform(eulerToMat(j.rpy[0], j.rpy[1], j.rpy[2], 'xyz'), j.xyz)
      let Tm: Mat4 = makeTransform([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0])
      const v = value(j)
      const n = Math.hypot(...j.axis) || 1
      const a: Vec3 = [j.axis[0] / n, j.axis[1] / n, j.axis[2] / n]
      if (j.type === 'revolute' || j.type === 'continuous') Tm = makeTransform(rotvecToMat(a[0] * v, a[1] * v, a[2] * v), [0, 0, 0])
      else if (j.type === 'prismatic') Tm = makeTransform([1, 0, 0, 0, 1, 0, 0, 0, 1], [a[0] * v, a[1] * v, a[2] * v])
      out.set(j.child, mul4(Tp, mul4(T0, Tm)))
      visit(j.child)
    }
  }
  visit(model.root)
  return out
}

const norm = (s: string) => s.toLowerCase().replace(/(_?joint|_?pos(ition)?|_?rad|\.pos)$/g, '').replace(/[^a-z0-9]/g, '')

/**
 * Map URDF movable joints to dataset dimensions: exact / normalised name match first,
 * then remaining joints in depth-first order onto remaining joint dims (left arm before right arm).
 */
export function autoJointMap(model: UrdfModel, dims: { id: string; name: string }[]): Record<string, string | null> {
  const map: Record<string, string | null> = {}
  const used = new Set<string>()
  for (const j of model.movable) {
    const hit = dims.find((d) => !used.has(d.id) && (d.name === j.name || norm(d.name) === norm(j.name)))
    if (hit) {
      map[j.name] = hit.id
      used.add(hit.id)
    }
  }
  const rest = dims.filter((d) => !used.has(d.id))
  let k = 0
  for (const j of model.movable) if (!(j.name in map)) map[j.name] = rest[k++]?.id ?? null
  return map
}

/** Links without children are drawn as end-effector frames. */
export function leafLinks(model: UrdfModel): string[] {
  const parents = new Set(model.joints.map((j) => j.parent))
  return model.links.filter((l) => !parents.has(l) && l !== model.root)
}
