import { useEffect, useState } from 'react'
import type { DatasetEntry } from './store'
import { schemaSignature } from './overrides'
import type { UrdfModel } from '@core/robot/urdf'
import { autoJointMap, parseUrdf } from '@core/robot/urdf'

/** A URDF attached to a dataset schema plus the URDF-joint → dataset-dimension mapping. */
export interface RobotBinding {
  fileName: string
  model: UrdfModel
  /** urdf joint name -> "<feature>#<dim>" or null */
  map: Record<string, string | null>
}

export interface JointDim {
  id: string
  name: string
  feature: string
  dim: number
  deg: boolean
}

const KEY = (entry: DatasetEntry) => `embodiscope.urdf.${schemaSignature(entry.ds)}`
const listeners = new Set<() => void>()
const cache = new Map<string, RobotBinding | null>()

/** Dataset dimensions that can drive URDF joints (observed joint-like signals). */
export function jointDims(entry: DatasetEntry): JointDim[] {
  const roles = new Set(['joint_position', 'gripper', 'hand_joints', 'head', 'torso'])
  return entry.sem.segments
    .filter((s) => s.stream === 'observation' && roles.has(s.role))
    .flatMap((s) =>
      Array.from({ length: s.end - s.start }, (_, k) => ({
        id: `${s.feature}#${s.start + k}`,
        name: s.names[k] ?? `${s.feature}[${s.start + k}]`,
        feature: s.feature,
        dim: s.start + k,
        // LeRobot RANGE_M100_100 motors are calibrated so that ±100 roughly spans the joint range in degrees
        deg: s.units?.angle === 'deg' || s.units?.angle === 'normalized',
      })),
    )
}

export function getRobot(entry: DatasetEntry): RobotBinding | null {
  const k = KEY(entry)
  if (cache.has(k)) return cache.get(k)!
  let b: RobotBinding | null = null
  try {
    const raw = localStorage.getItem(k)
    if (raw) {
      const j = JSON.parse(raw) as { fileName: string; xml: string; map: Record<string, string | null> }
      b = { fileName: j.fileName, model: parseUrdf(j.xml), map: j.map }
    }
  } catch {
    b = null
  }
  cache.set(k, b)
  return b
}

export function setRobot(entry: DatasetEntry, fileName: string | null, xml?: string, map?: Record<string, string | null>) {
  const k = KEY(entry)
  if (!fileName || !xml) {
    localStorage.removeItem(k)
    cache.set(k, null)
  } else {
    const model = parseUrdf(xml)
    const m = map ?? autoJointMap(model, jointDims(entry))
    cache.set(k, { fileName, model, map: m })
    try {
      localStorage.setItem(k, JSON.stringify({ fileName, xml, map: m }))
    } catch {
      // very large URDF: keep for this session only
    }
  }
  for (const l of listeners) l()
}

export function updateRobotMap(entry: DatasetEntry, joint: string, dim: string | null) {
  const b = getRobot(entry)
  if (!b) return
  const raw = localStorage.getItem(KEY(entry))
  const xml = raw ? (JSON.parse(raw).xml as string) : null
  const map = { ...b.map, [joint]: dim }
  cache.set(KEY(entry), { ...b, map })
  if (xml) localStorage.setItem(KEY(entry), JSON.stringify({ fileName: b.fileName, xml, map }))
  for (const l of listeners) l()
}

export function useRobot(entry: DatasetEntry): RobotBinding | null {
  const [, tick] = useState(0)
  useEffect(() => {
    const l = () => tick((x) => x + 1)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  return getRobot(entry)
}
