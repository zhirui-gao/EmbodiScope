import type { LeRobotDataset } from '../lerobot/types'
import { median } from '../math/stats'
import type { DatasetSemantics } from '../semantics/types'
import type { EpisodeMetrics } from './episodeMetrics'
import type { VideoProbe } from '../video/mp4'
import { browserCanPlay } from '../video/mp4'

export type Severity = 'error' | 'warning' | 'info'
export type Category = 'structure' | 'timing' | 'signal' | 'video' | 'annotation' | 'convention'
/** Bilingual text. */
export interface L {
  en: string
  zh: string
}

export interface Issue {
  check: string
  severity: Severity
  category: Category
  title: L
  detail: L
  hint?: L
  episodes?: number[]
}

export interface QaContext {
  ds: LeRobotDataset
  sem: DatasetSemantics
  metrics?: EpisodeMetrics[]
  videos?: Record<string, VideoProbe>
}

/**
 * A quality check. `needs` declares which context it requires: `static` checks run instantly
 * from metadata, `scan` checks need per-episode metrics, `video` checks need probed MP4 headers.
 */
export interface QaCheck {
  id: string
  category: Category
  needs: 'static' | 'scan' | 'video'
  run(ctx: QaContext): Issue[]
}

const l = (en: string, zh: string): L => ({ en, zh })
const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—')
const listEps = (eps: number[]) => (eps.length > 8 ? `${eps.slice(0, 8).join(', ')} … (+${eps.length - 8})` : eps.join(', '))

export const CHECKS: QaCheck[] = [
  {
    id: 'meta.warnings',
    category: 'structure',
    needs: 'static',
    run: ({ ds }) =>
      ds.warnings.map((w) => {
        // a partial local copy or per-frame task references are facts about the copy, not defects of the data
        const benign = /partial download|sampled subset|task_index/.test(w)
        return {
          check: 'meta.warnings',
          severity: (benign ? 'info' : 'warning') as Severity,
          category: 'structure' as Category,
          title: benign ? l('Metadata note', '元数据说明') : l('Metadata inconsistency', '元数据不一致'),
          detail: l(w, w),
        }
      }),
  },
  {
    id: 'meta.convention',
    category: 'convention',
    needs: 'static',
    run: ({ ds, sem }) => {
      const out: Issue[] = []
      if (!ds.info.convention)
        out.push({
          check: 'meta.convention',
          severity: 'info',
          category: 'convention',
          title: l('No declared conventions', '未声明坐标/单位约定'),
          detail: l(
            'info.json has no "convention" block (camera model, quaternion order, units). Conventions shown here are inferred.',
            'info.json 中没有 "convention" 字段（相机模型、四元数顺序、单位），本平台展示的约定为自动推断结果。',
          ),
          hint: l('Declare {"camera": "opencv", "quaternion": "xyzw", "units": {...}} in info.json.', '建议在 info.json 中声明 {"camera": "opencv", "quaternion": "xyzw", "units": {...}}。'),
        })
      const amb = sem.segments.filter((s) => s.pose?.rot?.ambiguous && s.stream !== 'action')
      if (amb.length)
        out.push({
          check: 'meta.convention',
          severity: 'warning',
          category: 'convention',
          title: l('Ambiguous rotation representation', '旋转表示存在歧义'),
          detail: l(
            `${amb.map((s) => s.id).join(', ')}: names do not say whether the 3 numbers are Euler angles (which order?) or a rotation vector.`,
            `${amb.map((s) => s.id).join(', ')}：字段名无法确定这 3 个数是欧拉角（哪种顺序？）还是旋转向量。`,
          ),
          hint: l('Check the coordinate axes in the 3D view against the video and fix the representation in the Schema tab.', '在 3D 视图中对照视频检查坐标轴方向，并在“语义结构”页修正表示方式。'),
        })
      if (sem.conventions.quaternion === 'mixed')
        out.push({
          check: 'meta.convention',
          severity: 'warning',
          category: 'convention',
          title: l('Mixed quaternion orders', '四元数顺序混用'),
          detail: l('Some features store quaternions as xyzw and others as wxyz.', '部分特征使用 xyzw，部分使用 wxyz。'),
        })
      return out
    },
  },
  {
    id: 'meta.names',
    category: 'structure',
    needs: 'static',
    run: ({ ds, sem }) => {
      // features already explained by a profile, the user, an LLM or modality.json are fine
      const explained = (key: string) => {
        const segs = sem.segments.filter((s) => s.feature === key)
        return segs.length > 0 && segs.every((s) => s.overridden || s.confidence >= 0.95)
      }
      const unnamed = ds.features.filter((f) => !f.isVideo && !f.isImage && f.dim > 1 && !f.names && !explained(f.key))
      const generic = ds.features.filter((f) => f.names && f.names.every((n) => /^(motor|joint|dim|axis|state|actions?)?_?\d*$/.test(n)) && f.dim > 2 && !f.key.includes('joint') && !explained(f.key))
      const unknown = sem.segments.filter((s) => s.role === 'unknown')
      const out: Issue[] = []
      if (unnamed.length || generic.length)
        out.push({
          check: 'meta.names',
          severity: 'info',
          category: 'structure',
          title: l('Vector features without meaningful names', '向量特征缺少有意义的维度名'),
          detail: l(
            `${[...unnamed, ...generic].map((f) => `${f.key} (${f.dim})`).join(', ')} — semantics are inferred from values or profiles.`,
            `${[...unnamed, ...generic].map((f) => `${f.key} (${f.dim})`).join(', ')} —— 语义只能依据数值范围或数据集配置推断。`,
          ),
        })
      if (unknown.length)
        out.push({
          check: 'meta.names',
          severity: 'warning',
          category: 'structure',
          title: l('Uninterpreted signals', '无法解析语义的信号'),
          detail: l(unknown.map((s) => s.id).join(', '), unknown.map((s) => s.id).join(', ')),
          hint: l('Use “AI format analysis” or set roles manually in the Schema tab.', '可使用“AI 格式分析”或在“语义结构”页手动设置角色。'),
        })
      return out
    },
  },
  {
    id: 'meta.fps',
    category: 'timing',
    needs: 'static',
    run: ({ ds, sem }) => {
      const bad = sem.cameras.filter((c) => c.fps && Math.abs(c.fps - ds.fps) > 0.01)
      return bad.length
        ? [
            {
              check: 'meta.fps',
              severity: 'warning',
              category: 'timing',
              title: l('Video fps differs from dataset fps', '视频帧率与数据帧率不一致'),
              detail: l(bad.map((c) => `${c.name}: ${c.fps} vs ${ds.fps}`).join('; '), bad.map((c) => `${c.name}: ${c.fps} vs ${ds.fps}`).join('；')),
            },
          ]
        : []
    },
  },
  {
    id: 'annotation.language',
    category: 'annotation',
    needs: 'static',
    run: ({ ds }) => {
      const out: Issue[] = []
      const empty = ds.episodes.filter((e) => !e.tasks.length || e.tasks.every((t) => !t.trim()))
      // v3 conversions may omit episodes.tasks while frames still reference meta/tasks via task_index
      const perFrame = ds.tasks.length > 0 && ds.warnings.some((w) => w.includes('task_index'))
      if (empty.length && perFrame)
        out.push({
          check: 'annotation.language',
          severity: 'info',
          category: 'annotation',
          title: l('Instructions only referenced per frame', '指令只在帧级 task_index 中引用'),
          detail: l(
            `episodes metadata lists no tasks; ${ds.tasks.length} instructions exist in meta/tasks and are resolved from task_index when episodes are loaded / scanned (${empty.length} not resolved yet).`,
            `episodes 元数据未列出指令；meta/tasks 中有 ${ds.tasks.length} 条指令，加载或扫描 episode 时通过 task_index 解析（尚有 ${empty.length} 个未解析）。`,
          ),
        })
      else if (empty.length)
        out.push({
          check: 'annotation.language',
          severity: 'warning',
          category: 'annotation',
          title: l('Episodes without instruction', 'Episode 缺少语言指令'),
          detail: l(`${empty.length} episodes: ${listEps(empty.map((e) => e.index))}`, `${empty.length} 个 episode：${listEps(empty.map((e) => e.index))}`),
          episodes: empty.map((e) => e.index),
        })
      const uniq = new Set(ds.episodes.flatMap((e) => e.tasks))
      if (ds.episodes.length >= 20 && uniq.size === 1)
        out.push({
          check: 'annotation.language',
          severity: 'info',
          category: 'annotation',
          title: l('Single instruction for all episodes', '所有 episode 共用一条指令'),
          detail: l('Language conditioning carries no information; consider subtask / caption annotation.', '语言条件不携带区分信息，建议补充子任务分解或 caption 标注。'),
        })
      return out
    },
  },
  {
    id: 'video.codec',
    category: 'video',
    needs: 'static',
    run: ({ sem }) => {
      const out: Issue[] = []
      for (const c of sem.cameras) {
        if (!c.codec) continue
        const ok = browserCanPlay(c.codec)
        if (ok === false)
          out.push({
            check: 'video.codec',
            severity: 'error',
            category: 'video',
            title: l(`Codec "${c.codec}" not decodable in browsers`, `视频编码 "${c.codec}" 浏览器无法解码`),
            detail: l(
              `${c.key}: browsers (and many training dataloaders using torchcodec / PyAV builds) cannot decode this codec.`,
              `${c.key}：浏览器（以及部分基于 torchcodec / PyAV 的训练数据加载器）无法解码该编码。`,
            ),
            hint: l('Re-encode with libsvtav1 (LeRobot default) or H.264.', '建议使用 libsvtav1（LeRobot 默认）或 H.264 重新编码。'),
          })
      }
      return out
    },
  },
  {
    id: 'video.probe',
    category: 'video',
    needs: 'video',
    run: ({ ds, videos }) => {
      if (!videos) return []
      const out: Issue[] = []
      const mismatch: string[] = []
      for (const [key, p] of Object.entries(videos)) {
        if (p.error) {
          out.push({ check: 'video.probe', severity: 'error', category: 'video', title: l('Unreadable video', '视频无法解析'), detail: l(`${key}: ${p.error}`, `${key}：${p.error}`) })
          continue
        }
        if (p.fps && Math.abs(p.fps - ds.fps) > 0.5) mismatch.push(`${key}: ${p.fps.toFixed(2)} fps`)
        if (p.codec && browserCanPlay(p.codec) === false)
          out.push({ check: 'video.probe', severity: 'error', category: 'video', title: l(`Codec "${p.codec}" not decodable in browsers`, `视频编码 "${p.codec}" 浏览器无法解码`), detail: l(key, key) })
      }
      if (mismatch.length)
        out.push({ check: 'video.probe', severity: 'warning', category: 'video', title: l('Video frame rate differs from dataset fps', '视频实际帧率与数据集 fps 不一致'), detail: l(mismatch.join('; '), mismatch.join('；')) })
      // one-episode-per-file layouts (v2.x): the video should hold exactly `length` frames
      if (!ds.version.startsWith('v3')) {
        const bad: string[] = []
        const eps: number[] = []
        for (const [key, p] of Object.entries(videos)) {
          const [cam, epStr] = key.split('@')
          const ep = ds.episodes.find((e) => e.index === Number(epStr))
          if (!ep || !p.frames || !ep.length) continue
          if (Math.abs(p.frames - ep.length) > 1) {
            bad.push(`${cam.split('.').pop()} ep${ep.index}: ${p.frames} video frames vs ${ep.length} rows`)
            eps.push(ep.index)
          }
        }
        if (bad.length)
          out.push({
            check: 'video.probe',
            severity: 'warning',
            category: 'video',
            title: l('Video length differs from data length', '视频帧数与数据帧数不一致'),
            detail: l(bad.slice(0, 6).join('; ') + (bad.length > 6 ? ` … (+${bad.length - 6})` : ''), bad.slice(0, 6).join('；') + (bad.length > 6 ? ` …（另 ${bad.length - 6} 条）` : '')),
            hint: l('Frame / timestamp alignment between video and proprioception is unreliable for these episodes.', '这些 episode 的视频与本体数据时间对齐可能不可靠。'),
            episodes: [...new Set(eps)],
          })
      }
      return out
    },
  },
  {
    id: 'timing',
    category: 'timing',
    needs: 'scan',
    run: ({ metrics, ds }) => {
      if (!metrics?.length) return []
      const out: Issue[] = []
      const nonMono = metrics.filter((m) => m.nonMonotonic > 0)
      if (nonMono.length)
        out.push({
          check: 'timing',
          severity: 'error',
          category: 'timing',
          title: l('Non-monotonic timestamps', '时间戳非单调'),
          detail: l(`${nonMono.length} episodes: ${listEps(nonMono.map((m) => m.episode))}`, `${nonMono.length} 个 episode：${listEps(nonMono.map((m) => m.episode))}`),
          episodes: nonMono.map((m) => m.episode),
        })
      const gaps = metrics.filter((m) => m.maxGapFrames > 1.5)
      if (gaps.length)
        out.push({
          check: 'timing',
          severity: 'warning',
          category: 'timing',
          title: l('Dropped frames / timestamp gaps', '丢帧 / 时间戳跳变'),
          detail: l(
            `${gaps.length} episodes have steps > 1.5 frame periods (worst ${fmt(Math.max(...gaps.map((m) => m.maxGapFrames)), 1)}×): ${listEps(gaps.map((m) => m.episode))}`,
            `${gaps.length} 个 episode 存在超过 1.5 帧周期的时间步（最大 ${fmt(Math.max(...gaps.map((m) => m.maxGapFrames)), 1)} 倍）：${listEps(gaps.map((m) => m.episode))}`,
          ),
          episodes: gaps.map((m) => m.episode),
        })
      const jitter = metrics.filter((m) => m.irregularSteps > 0.05 * m.length)
      if (jitter.length)
        out.push({
          check: 'timing',
          severity: 'warning',
          category: 'timing',
          title: l('Irregular sampling', '采样间隔不均匀'),
          detail: l(`${jitter.length} episodes have >5 % irregular time steps (nominal ${ds.fps} fps)`, `${jitter.length} 个 episode 超过 5% 的时间步偏离标称 ${ds.fps} fps`),
          episodes: jitter.map((m) => m.episode),
        })
      const offset = metrics.filter((m) => Math.abs(m.startTimestamp) > 1e-3)
      if (offset.length)
        out.push({
          check: 'timing',
          severity: 'info',
          category: 'timing',
          title: l('Timestamps do not start at 0', '时间戳不从 0 开始'),
          detail: l(`${offset.length} episodes`, `${offset.length} 个 episode`),
          episodes: offset.map((m) => m.episode),
        })
      const fi = metrics.filter((m) => !m.frameIndexOk)
      if (fi.length)
        out.push({ check: 'timing', severity: 'warning', category: 'structure', title: l('frame_index is not 0…T-1', 'frame_index 不连续'), detail: l(listEps(fi.map((m) => m.episode)), listEps(fi.map((m) => m.episode))), episodes: fi.map((m) => m.episode) })
      const meta = new Map(ds.episodes.map((e) => [e.index, e.length]))
      const lenBad = metrics.filter((m) => meta.get(m.episode) && meta.get(m.episode) !== m.length)
      if (lenBad.length)
        out.push({ check: 'timing', severity: 'warning', category: 'structure', title: l('Episode length differs from metadata', 'Episode 实际帧数与元数据不符'), detail: l(listEps(lenBad.map((m) => m.episode)), listEps(lenBad.map((m) => m.episode))), episodes: lenBad.map((m) => m.episode) })
      return out
    },
  },
  {
    id: 'signal',
    category: 'signal',
    needs: 'scan',
    run: ({ metrics, ds }) => {
      if (!metrics?.length) return []
      const out: Issue[] = []
      const nan = metrics.filter((m) => m.nanCount > 0)
      if (nan.length)
        out.push({
          check: 'signal',
          severity: 'error',
          category: 'signal',
          title: l('NaN / Inf values', '存在 NaN / Inf'),
          detail: l(`${nan.length} episodes, features: ${[...new Set(nan.flatMap((m) => m.nanFeatures))].slice(0, 6).join(', ')}`, `${nan.length} 个 episode，涉及特征：${[...new Set(nan.flatMap((m) => m.nanFeatures))].slice(0, 6).join(', ')}`),
          episodes: nan.map((m) => m.episode),
        })
      const fps = ds.fps || 30
      const idle = metrics.filter((m) => m.idleHead + m.idleTail > Math.max(1, 0.2 * m.duration))
      if (idle.length) {
        const avg = idle.reduce((a, m) => a + m.idleHead + m.idleTail, 0) / idle.length
        out.push({
          check: 'signal',
          severity: 'warning',
          category: 'signal',
          title: l('Long idle segments at episode start / end', 'Episode 首尾存在较长静止段'),
          detail: l(
            `${idle.length} episodes idle > 20 % (avg ${fmt(avg, 1)} s ≈ ${Math.round(avg * fps)} frames). Policies trained on these learn to wait.`,
            `${idle.length} 个 episode 首尾静止超过 20%（平均 ${fmt(avg, 1)} 秒 ≈ ${Math.round(avg * fps)} 帧），会让策略学到“等待”行为。`,
          ),
          hint: l('Trim idle frames before training or weight them down.', '训练前建议裁剪静止帧或降低其权重。'),
          episodes: idle.map((m) => m.episode),
        })
      }
      const ratios = metrics.flatMap((m) => Object.values(m.maxJumpRatio))
      const thr = Math.max(6, 3 * median(ratios))
      const spikes = metrics.filter((m) => Object.values(m.maxJumpRatio).some((r) => r > thr))
      if (spikes.length)
        out.push({
          check: 'signal',
          severity: 'warning',
          category: 'signal',
          title: l('Action spikes / discontinuities', '动作存在尖峰 / 跳变'),
          detail: l(`${spikes.length} episodes have a single-step action change > ${fmt(thr, 1)}× their 99th percentile`, `${spikes.length} 个 episode 存在单步动作变化超过自身 99 分位 ${fmt(thr, 1)} 倍的跳变`),
          hint: l('Inspect these episodes — often teleoperation glitches, IK flips or recording restarts.', '建议逐个检查，常见原因为遥操作抖动、IK 解翻转或录制中断。'),
          episodes: spikes.map((m) => m.episode),
        })
      const qn = metrics.filter((m) => m.quatNormErr > 0.01)
      if (qn.length)
        out.push({ check: 'signal', severity: 'warning', category: 'convention', title: l('Non-unit quaternions', '四元数未归一化'), detail: l(`max | |q| − 1 | = ${fmt(Math.max(...qn.map((m) => m.quatNormErr)), 3)}`, `最大 | |q| − 1 | = ${fmt(Math.max(...qn.map((m) => m.quatNormErr)), 3)}`), episodes: qn.map((m) => m.episode) })
      const flips = metrics.filter((m) => m.quatSignFlips > 0)
      if (flips.length)
        out.push({
          check: 'signal',
          severity: 'info',
          category: 'convention',
          title: l('Quaternion sign flips (q ↔ −q)', '四元数符号翻转（q ↔ −q）'),
          detail: l(`${flips.length} episodes. Same rotation, but discontinuous as a regression target.`, `${flips.length} 个 episode。旋转相同，但作为回归目标是不连续的。`),
          hint: l('Canonicalise (w ≥ 0 or continuity) or use a 6D rotation representation for learning.', '建议规范化符号（w ≥ 0 或保持连续）或改用 6D 旋转表示训练。'),
          episodes: flips.map((m) => m.episode),
        })
      const wraps = metrics.filter((m) => m.eulerWraps > 0)
      if (wraps.length)
        out.push({
          check: 'signal',
          severity: 'info',
          category: 'convention',
          title: l('Euler angle wrap-around (±π)', '欧拉角 ±π 跳变'),
          detail: l(`${wraps.length} episodes contain jumps > π between consecutive frames.`, `${wraps.length} 个 episode 中相邻帧角度跳变超过 π。`),
          hint: l('Unwrap angles or convert to quaternion / 6D before normalisation.', '建议做角度展开，或在归一化前转换为四元数 / 6D 表示。'),
          episodes: wraps.map((m) => m.episode),
        })
      const shortT = metrics.filter((m) => m.length < 0.2 * median(metrics.map((x) => x.length)))
      if (shortT.length)
        out.push({ check: 'signal', severity: 'info', category: 'structure', title: l('Unusually short episodes', '异常短的 episode'), detail: l(listEps(shortT.map((m) => m.episode)), listEps(shortT.map((m) => m.episode))), episodes: shortT.map((m) => m.episode) })
      const still = metrics.filter((m) => m.motion > 0 && m.idleRatio > 0.9)
      if (still.length)
        out.push({ check: 'signal', severity: 'warning', category: 'signal', title: l('Nearly static episodes', '几乎没有运动的 episode'), detail: l(listEps(still.map((m) => m.episode)), listEps(still.map((m) => m.episode))), episodes: still.map((m) => m.episode) })
      return out
    },
  },
  {
    id: 'action.alignment',
    category: 'signal',
    needs: 'scan',
    run: ({ metrics, ds }) => {
      if (!metrics?.length) return []
      const out: Issue[] = []
      const ids = [...new Set(metrics.flatMap((m) => Object.keys(m.actionLag)))]
      const identicalIds: string[] = []
      const byLag = new Map<number, { id: string; errLag: number; err0: number }[]>()
      for (const id of ids) {
        const rows = metrics.map((m) => m.actionLag[id]).filter(Boolean)
        if (rows.filter((r) => r.identical).length > rows.length * 0.5) {
          identicalIds.push(id)
          continue
        }
        const lag = Math.round(median(rows.map((r) => r.lag)))
        const errLag = median(rows.map((r) => r.errAtLag))
        const err0 = median(rows.map((r) => r.errAt0))
        // only meaningful when the action actually tracks the state
        if (errLag > 0.25) continue
        if (!byLag.has(lag)) byLag.set(lag, [])
        byLag.get(lag)!.push({ id, errLag, err0 })
      }
      if (identicalIds.length)
        out.push({
          check: 'action.alignment',
          severity: 'warning',
          category: 'signal',
          title: l(`Action equals current state (${identicalIds.length} signals)`, `动作与当前状态逐帧完全相同（${identicalIds.length} 路信号）`),
          detail: l(
            `${identicalIds.join(', ')}: action[t] == state[t] in most episodes, so the action carries no future information unless shifted.`,
            `${identicalIds.join(', ')}：多数 episode 中 action[t] == state[t]，除非训练时做时间平移，否则动作不含未来信息。`,
          ),
          hint: l('Use state[t+k] as the supervision target (shifted action chunks) or verify the recording pipeline.', '可用 state[t+k] 作为监督目标（带偏移的 action chunk），或检查数据录制管线。'),
        })
      for (const [lag, rows] of [...byLag].sort((a, b) => a[0] - b[0]))
        out.push({
          check: 'action.alignment',
          severity: 'info',
          category: 'signal',
          title: l(
            lag === 0 ? `Action tracks state at lag 0 (${rows.length} signals)` : `Action leads state by ~${lag} frame${lag > 1 ? 's' : ''} (${rows.length} signals)`,
            lag === 0 ? `动作与状态同帧对齐（${rows.length} 路信号）` : `动作领先状态约 ${lag} 帧（${rows.length} 路信号）`,
          ),
          detail: l(
            rows.map((r) => `${r.id} (err ${fmt(r.errLag, 4)} vs ${fmt(r.err0, 4)} @0)`).join(', '),
            rows.map((r) => `${r.id}（误差 ${fmt(r.errLag, 4)}，零延迟 ${fmt(r.err0, 4)}）`).join('，'),
          ),
          hint: lag > 0 ? l(`A controller latency of ~${((lag / (ds.fps || 30)) * 1000).toFixed(0)} ms; relevant for action horizon / chunk alignment.`, `相当于约 ${((lag / (ds.fps || 30)) * 1000).toFixed(0)} ms 的控制延迟，设计 action horizon / chunk 对齐时需考虑。`) : undefined,
        })
      return out
    },
  },
]

CHECKS.push({
  id: 'action.bandwidth',
  category: 'signal',
  needs: 'scan',
  run: ({ metrics, ds }) => {
    if (!metrics?.length) return []
    const fps = ds.fps || 30
    const ids = [...new Set(metrics.flatMap((m) => Object.keys(m.bandwidth90 ?? {})))]
    const rows = ids
      .map((id) => ({ id, hz: median(metrics.map((m) => m.bandwidth90?.[id]).filter((x): x is number => Number.isFinite(x))) }))
      .filter((r) => Number.isFinite(r.hz))
    if (!rows.length) return []
    const worst = median(rows.map((r) => r.hz))
    const factor = Math.max(1, Math.floor(fps / (2.5 * worst)))
    return [
      {
        check: 'action.bandwidth',
        severity: 'info',
        category: 'signal',
        title: l(`Motion bandwidth: 90 % of action energy below ${fmt(worst, 2)} Hz`, `运动带宽：90% 的动作能量低于 ${fmt(worst, 2)} Hz`),
        detail: l(
          rows.map((r) => `${r.id}: ${fmt(r.hz, 2)} Hz`).join(', ') + ` (dataset ${fps} fps).`,
          rows.map((r) => `${r.id}：${fmt(r.hz, 2)} Hz`).join('，') + `（数据集 ${fps} fps）。`,
        ),
        hint:
          factor > 1
            ? l(
                `Control at ≥ ${fmt(2.5 * worst, 1)} Hz preserves the motion; temporal subsampling by up to ${factor}× (→ ${fmt(fps / factor, 1)} fps) loses little, and a 1 s action chunk spans ${Math.round(fps)} raw steps.`,
                `以 ≥ ${fmt(2.5 * worst, 1)} Hz 控制即可保留运动信息；最多可做 ${factor} 倍时间降采样（→ ${fmt(fps / factor, 1)} fps）而损失很小，1 秒的 action chunk 对应 ${Math.round(fps)} 个原始步。`,
              )
            : l('Motion content is close to the sampling rate; avoid temporal subsampling.', '运动频率接近采样率，不建议做时间降采样。'),
      },
    ]
  },
})

export function runChecks(ctx: QaContext): Issue[] {
  const out: Issue[] = []
  for (const c of CHECKS) {
    if (c.needs === 'scan' && !ctx.metrics) continue
    if (c.needs === 'video' && !ctx.videos) continue
    try {
      out.push(...c.run(ctx))
    } catch (e) {
      out.push({ check: c.id, severity: 'info', category: c.category, title: l(`Check "${c.id}" failed`, `检查 "${c.id}" 执行失败`), detail: l(String(e), String(e)) })
    }
  }
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}
