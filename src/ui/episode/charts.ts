import type { FrameTable } from '@core/data/frameTable'
import type { DatasetSemantics, Segment } from '@core/semantics/types'
import { PALETTE } from '../common'
import type { ChartSeries } from './SignalChart'
import { ROLE_LABEL } from '@app/i18n'
import { term } from '@app/terms'

export interface ChartGroup {
  id: string
  title: string
  role: string
  series: ChartSeries[]
}

const PLOT_ROLES = new Set([
  'joint_position', 'joint_velocity', 'joint_effort', 'joint_current', 'gripper', 'hand_joints', 'eef_pose', 'eef_position',
  'delta_position', 'delta_rotation', 'base_pose', 'base_velocity', 'head', 'torso', 'position_2d', 'unknown', 'reward',
])

function dims(table: FrameTable, s: Segment, idx: number[], dash: boolean, prefix: string): ChartSeries[] {
  return idx.map((d, k) => ({
    label: `${prefix}${s.names[d] ?? d}`,
    values: table.series(s.feature, s.start + d),
    color: PALETTE[k % PALETTE.length],
    dash,
  }))
}

export function buildChartGroups(sem: DatasetSemantics, table: FrameTable, lang: 'zh' | 'en' = 'en'): ChartGroup[] {
  const groups: ChartGroup[] = []
  const used = new Set<string>()
  const segs = sem.segments.filter((s) => PLOT_ROLES.has(s.role) && s.end > s.start && table.has(s.feature))
  const role = (r: string) => ROLE_LABEL[r]?.[lang === 'zh' ? 1 : 0] ?? r
  const title = (s: Segment) => `${s.side ? term(lang, s.side) + (lang === 'zh' ? '' : ' ') : ''}${role(s.role)} · ${s.id}`
  for (const o of segs.filter((s) => s.stream === 'observation')) {
    const acts = segs.filter((a) => a.pairedWith === o.id && !used.has(a.id))
    const n = o.end - o.start
    const all = Array.from({ length: n }, (_, i) => i)
    if (o.pose?.pos && o.pose.rot) {
      const rotIdx = o.pose.rot.idx
      groups.push({ id: `${o.id}:pos`, title: `${title(o)} — xyz`, role: o.role, series: [...dims(table, o, o.pose.pos, false, ''), ...acts.flatMap((a) => dims(table, a, a.pose?.pos ?? o.pose!.pos!, true, 'act '))] })
      groups.push({ id: `${o.id}:rot`, title: `${title(o)} — ${o.pose.rot.repr}`, role: o.role, series: [...dims(table, o, rotIdx, false, ''), ...acts.flatMap((a) => dims(table, a, a.pose?.rot?.idx ?? rotIdx, true, 'act '))] })
    } else {
      const series = [...dims(table, o, all.slice(0, 16), false, ''), ...acts.flatMap((a) => dims(table, a, all.slice(0, 16), true, 'act '))]
      groups.push({ id: o.id, title: title(o) + (acts.length ? ` ⟷ ${acts.map((a) => a.id).join(', ')}` : ''), role: o.role, series })
    }
    acts.forEach((a) => used.add(a.id))
  }
  for (const a of segs.filter((s) => (s.stream === 'action' || s.stream === 'teleop' || s.stream === 'meta') && !used.has(s.id))) {
    const n = a.end - a.start
    groups.push({ id: a.id, title: `${term(lang, a.stream)} · ${title(a)}`, role: a.role, series: dims(table, a, Array.from({ length: Math.min(16, n) }, (_, i) => i), a.stream !== 'meta', '') })
  }
  return groups
}
