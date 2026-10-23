import type { DatasetEntry } from './store'
import type { DatasetCard } from '@core/analysis/summary'
import { ROTATION_LABELS } from '@core/math/rotation'

const n = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—')

export function datasetMarkdown(entry: DatasetEntry, lang: 'zh' | 'en'): string {
  const { ds, sem, card, issues } = entry
  const zh = lang === 'zh'
  const lines: string[] = []
  lines.push(`# ${ds.name}`, '', `> EmbodiScope report · ${new Date().toISOString()} · source \`${ds.source.label}\``, '')
  lines.push(`## ${zh ? '概要' : 'Summary'}`, '')
  lines.push('| | |', '|---|---|')
  for (const [k, v] of cardRows(card, lang)) lines.push(`| ${k} | ${v} |`)
  lines.push('', `## ${zh ? '信号语义' : 'Signal semantics'}`, '')
  lines.push(`| id | stream | role | side | rotation | frame | units | action type |`, '|---|---|---|---|---|---|---|---|')
  for (const s of sem.segments.filter((x) => x.role !== 'index' && x.role !== 'body_keypoint'))
    lines.push(
      `| \`${s.id}\` | ${s.stream} | ${s.role} | ${s.side ?? ''} | ${s.pose?.rot ? s.pose.rot.repr + (s.pose.rot.ambiguous ? ' (?)' : '') : ''} | ${s.pose?.parent ? `${s.pose.child ?? ''}→${s.pose.parent}` : ''} | ${s.units ? Object.values(s.units).join(', ') : ''} | ${s.actionType ?? ''} |`,
    )
  const kp = sem.segments.filter((s) => s.role === 'body_keypoint').length
  if (kp) lines.push('', `${kp} ${zh ? '个人体/手部关键点位姿' : 'body / hand keypoint poses'}`)
  lines.push('', `## ${zh ? '质量问题' : 'Issues'}`, '')
  if (!issues.length) lines.push(zh ? '未发现问题。' : 'No issues found.')
  for (const i of issues) {
    lines.push(`- **[${i.severity}] ${i.title[lang]}** — ${i.detail[lang]}`)
    if (i.hint) lines.push(`  - ${zh ? '建议' : 'Hint'}: ${i.hint[lang]}`)
  }
  if (entry.scan?.status === 'done') {
    const m = entry.scan.metrics
    const avg = (f: (x: (typeof m)[number]) => number) => m.reduce((a, x) => a + f(x), 0) / Math.max(1, m.length)
    lines.push('', `## ${zh ? '扫描统计' : 'Scan statistics'} (${m.length} episodes)`, '')
    lines.push(`- ${zh ? '首尾静止' : 'idle head+tail'}: ${n(avg((x) => x.idleHead + x.idleTail), 2)} s`)
    lines.push(`- ${zh ? '静止帧比例' : 'idle ratio'}: ${n(avg((x) => x.idleRatio) * 100, 1)} %`)
    lines.push(`- ${zh ? '夹爪开合次数' : 'gripper events'}: ${n(avg((x) => x.gripperEvents), 1)}`)
  }
  return lines.join('\n')
}

export function cardRows(c: DatasetCard, lang: 'zh' | 'en'): [string, string][] {
  const zh = lang === 'zh'
  return [
    [zh ? '版本' : 'Version', c.version],
    ['robot_type', c.robotType],
    [zh ? '本体' : 'Embodiment', c.embodiment + (c.mobileBase ? ' + mobile base' : '')],
    [zh ? '末端执行器' : 'End effector', c.endEffector],
    ['fps', String(c.fps)],
    ['Episodes', `${c.episodes}${c.availableEpisodes !== c.episodes ? ` (${c.availableEpisodes} local)` : ''}`],
    [zh ? '帧数' : 'Frames', String(c.frames)],
    [zh ? '总时长 (h)' : 'Hours', n(c.hours, 2)],
    [zh ? 'Episode 时长中位数 (s)' : 'Median episode (s)', n(c.episodeSeconds.median, 1)],
    [zh ? '相机' : 'Cameras', c.cameras.map((x) => `${x.name} ${x.resolution} ${x.codec}`).join('; ')],
    [zh ? '状态维度' : 'State dim', `${c.stateDim}: ${c.stateComposition}`],
    [zh ? '动作维度' : 'Action dim', `${c.actionDim}: ${c.actionComposition}`],
    [zh ? '动作空间' : 'Action space', `${c.actionSpace} (${c.actionType})`],
    [zh ? '旋转表示' : 'Rotation', c.rotationReprs.map((r) => ROTATION_LABELS[r]).join('; ') || '—'],
    [zh ? '四元数顺序' : 'Quaternion order', c.quaternionOrder],
    [zh ? '参考系' : 'Reference frames', c.referenceFrames.join(', ') || '—'],
    [zh ? '单位' : 'Units', `${c.lengthUnits} / ${c.angleUnits}`],
    [zh ? '夹爪极性' : 'Gripper polarity', c.gripperPolarity],
    [zh ? '内参/外参/深度' : 'Intrinsics/extrinsics/depth', `${c.hasIntrinsics ? '✓' : '✗'} / ${c.hasExtrinsics ? '✓' : '✗'} / ${c.hasDepth ? '✓' : '✗'}`],
    [zh ? '标注层级' : 'Annotation levels', c.annotation.levels.join(', ')],
    [zh ? '标注精细度评分' : 'Granularity score', `${n(c.annotation.granularityScore, 1)} / 5`],
    [zh ? '不同指令数' : 'Unique instructions', String(c.annotation.uniqueInstructions)],
    [zh ? '约定声明' : 'Conventions declared', c.conventionDeclared ? '✓' : '✗'],
  ]
}
