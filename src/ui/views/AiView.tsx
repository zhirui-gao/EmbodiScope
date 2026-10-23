import { useRef, useState } from 'react'
import type { DatasetEntry, EpisodeAnnotation } from '@app/store'
import { useStore } from '@app/store'
import { useL } from '@app/i18n'
import { download, selectEpisode } from '@app/actions'
import { PRESETS, chat, parseJsonLoose } from '@core/ai/llm'
import { datasetContext, formatAnalysisMessages, normalizeSegments, subtaskMessages } from '@core/ai/prompts'
import type { FormatAnalysis, SubtaskResult } from '@core/ai/prompts'
import { getEpisode } from '@app/episodeCache'
import { captureFrames, defaultAnnotationCamera, sampleFrameIndices } from '@app/frames'
import { heuristicSegments } from '@core/analysis/segmentation'
import { metadataSubtasks } from '@core/analysis/summary'
import { Badge, Panel } from '../common'

/** LLM schema analysis for a dataset; stores the result on the entry and opens the Schema tab. */
export async function runFormatAnalysis(entry: DatasetEntry) {
  const st = useStore.getState()
  const cfg = st.settings.llm
  if (!cfg.apiKey && !/localhost|127\.0\.0\.1/.test(cfg.baseUrl)) {
    st.notify(st.lang === 'zh' ? '请先在 AI 标注页配置 API Key' : 'Configure an API key in the AI lab first', 'error')
    st.set({ tab: 'ai' })
    return
  }
  st.set({ busy: st.lang === 'zh' ? 'AI 正在分析数据格式 …' : 'AI is analysing the schema …' })
  try {
    const ep = entry.ds.episodes.find((e) => e.available)
    const sample = ep ? (await getEpisode(entry, ep.index)).table : undefined
    const ctx = datasetContext(entry.ds, entry.sem, sample)
    const res = await chat(cfg, formatAnalysisMessages(ctx, st.lang), { json: true })
    const fa = parseJsonLoose<FormatAnalysis>(res.text)
    st.updateDataset(entry.id, () => ({ formatAnalysis: fa }))
    st.set({ tab: 'schema' })
    st.notify(st.lang === 'zh' ? `格式分析完成（${(res.ms / 1000).toFixed(1)} 秒）` : `Format analysis done in ${(res.ms / 1000).toFixed(1)} s`)
  } catch (e) {
    st.notify(String((e as Error).message), 'error')
  } finally {
    useStore.getState().set({ busy: null })
  }
}

function cues(entry: DatasetEntry, table: Parameters<typeof heuristicSegments>[0]): string {
  const segs = heuristicSegments(table, entry.sem, entry.ds.fps || 30)
  return segs.length > 1 ? segs.map((s) => `[${s.start}-${s.end}) ${s.text}`).join('; ') : ''
}

export function AiView({ entry }: { entry?: DatasetEntry }) {
  const L = useL()
  const lang = useStore((s) => s.lang)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const annotations = useStore((s) => (entry ? s.annotations[entry.id] ?? {} : {}))
  const setAnnotation = useStore((s) => s.setAnnotation)
  const episodeIndex = useStore((s) => s.episodeIndex)
  const llm = settings.llm
  const [test, setTest] = useState<string>('')
  const [cam, setCam] = useState<string | undefined>(entry ? defaultAnnotationCamera(entry) : undefined)
  const [nFrames, setNFrames] = useState(12)
  const [gran, setGran] = useState<'coarse' | 'fine'>('coarse')
  const [scope, setScope] = useState<'current' | 'first10' | 'all'>('current')
  const [concurrency, setConcurrency] = useState(2)
  const [useCues, setUseCues] = useState(true)
  const [progress, setProgress] = useState<{ done: number; total: number; errors: string[] } | null>(null)
  const cancel = useRef(false)
  const setLlm = (patch: Partial<typeof llm>) => updateSettings((s) => ({ ...s, llm: { ...s.llm, ...patch } }))

  const annotateEpisode = async (index: number) => {
    if (!entry || !cam) return
    const le = await getEpisode(entry, index)
    const frames = await captureFrames(entry, le.info, cam, sampleFrameIndices(le.table.length, nFrames))
    const msgs = subtaskMessages({
      instruction: le.info.tasks.join(' | '),
      fps: entry.ds.fps || 30,
      length: le.table.length,
      frames,
      signals: useCues ? cues(entry, le.table) : undefined,
      existing: metadataSubtasks(entry.ds, index),
      lang,
      granularity: gran,
    })
    const res = await chat(llm, msgs, { vision: true, json: true })
    const parsed = parseJsonLoose<SubtaskResult>(res.text)
    const a: EpisodeAnnotation = {
      segments: normalizeSegments(parsed, le.table.length),
      caption: parsed.episode_caption,
      scene: parsed.scene,
      success: parsed.success ?? null,
      model: llm.visionModel || llm.model,
      updatedAt: Date.now(),
    }
    setAnnotation(entry.id, index, a)
  }

  const runBatch = async () => {
    if (!entry) return
    const eps = entry.ds.episodes.filter((e) => e.available)
    const list = scope === 'current' ? [episodeIndex ?? eps[0]?.index].filter((x) => x != null) : scope === 'first10' ? eps.slice(0, 10).map((e) => e.index) : eps.map((e) => e.index)
    cancel.current = false
    const errors: string[] = []
    let done = 0
    setProgress({ done, total: list.length, errors })
    const queue = [...(list as number[])]
    await Promise.all(
      Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        for (;;) {
          const i = queue.shift()
          if (i === undefined || cancel.current) return
          try {
            await annotateEpisode(i)
          } catch (e) {
            errors.push(`#${i}: ${(e as Error).message}`)
          }
          done++
          setProgress({ done, total: list.length, errors: [...errors] })
        }
      }),
    )
  }

  const exportJsonl = () => {
    if (!entry) return
    const lines = Object.entries(annotations).map(([ep, a]) =>
      JSON.stringify({
        episode_index: Number(ep),
        instruction: entry.ds.episodes.find((e) => e.index === Number(ep))?.tasks ?? [],
        segments: a.segments.map((s) => ({ start_frame: s.start, end_frame: s.end, subtask: s.text, skill: s.skill, caption: s.caption })),
        episode_caption: a.caption,
        scene: a.scene,
        success: a.success,
        model: a.model,
      }),
    )
    download(`${entry.ds.name}_subtasks.jsonl`, lines.join('\n'), 'application/jsonl')
  }
  const exportEpisodesJsonl = () => {
    if (!entry) return
    const lines = entry.ds.episodes.map((e) => {
      const a = annotations[e.index]
      const base: Record<string, unknown> = { episode_index: e.index, tasks: e.tasks, length: e.length, ...e.extra }
      if (a) base.action_config = a.segments.map((s) => ({ start_frame: s.start, end_frame: s.end, action_text: s.text, skill: s.skill ?? '' }))
      if (a?.caption) base.caption = a.caption
      return JSON.stringify(base)
    })
    download('episodes.jsonl', lines.join('\n'), 'application/jsonl')
  }

  return (
    <div className="view">
      <h2 style={{ marginBottom: 10 }}>{L('AI lab', 'AI 标注实验室')}</h2>
      <div className="grid g2">
        <Panel title={L('Model provider', '模型服务')} actions={<Badge kind={llm.apiKey ? 'ok' : 'warn'}>{llm.apiKey ? L('key set', '已配置 Key') : L('no key', '未配置 Key')}</Badge>}>
          <div className="col">
            <label className="col">
              <span className="muted small">{L('Preset', '预设')}</span>
              <select
                value={llm.presetId}
                onChange={(e) => {
                  const p = PRESETS.find((x) => x.id === e.target.value)!
                  setLlm({ presetId: p.id, kind: p.kind, baseUrl: p.baseUrl, model: p.model, visionModel: p.visionModel })
                }}
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="row">
              <label className="col grow">
                <span className="muted small">API</span>
                <select value={llm.kind} onChange={(e) => setLlm({ kind: e.target.value as any })}>
                  <option value="openai">OpenAI-compatible</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Gemini</option>
                </select>
              </label>
              <label className="col" style={{ flex: 2 }}>
                <span className="muted small">Base URL</span>
                <input value={llm.baseUrl} onChange={(e) => setLlm({ baseUrl: e.target.value })} />
              </label>
            </div>
            <label className="col">
              <span className="muted small">
                API Key{' '}
                {PRESETS.find((p) => p.id === llm.presetId)?.keyUrl && (
                  <a href={PRESETS.find((p) => p.id === llm.presetId)!.keyUrl} target="_blank" rel="noreferrer">
                    ({L('get one', '获取')})
                  </a>
                )}
              </span>
              <input type="password" value={llm.apiKey} onChange={(e) => setLlm({ apiKey: e.target.value })} placeholder="sk-…" />
            </label>
            <div className="row">
              <label className="col grow">
                <span className="muted small">{L('Text model (format analysis)', '文本模型（格式分析）')}</span>
                <input value={llm.model} onChange={(e) => setLlm({ model: e.target.value })} />
              </label>
              <label className="col grow">
                <span className="muted small">{L('Vision model (subtasks / captions)', '多模态模型（子任务/caption）')}</span>
                <input value={llm.visionModel ?? ''} onChange={(e) => setLlm({ visionModel: e.target.value })} />
              </label>
            </div>
            <div className="row">
              <label className="row small muted">
                <input type="checkbox" checked={llm.persistKey} onChange={(e) => setLlm({ persistKey: e.target.checked })} /> {L('remember key on this computer', '在本机记住 Key')}
              </label>
              <label className="row small muted">
                <input type="checkbox" checked={llm.jsonMode !== false} onChange={(e) => setLlm({ jsonMode: e.target.checked })} /> JSON mode
              </label>
              <span className="spacer" />
              <button
                onClick={async () => {
                  setTest('…')
                  try {
                    const r = await chat(llm, [{ role: 'user', content: 'Reply with the single word: pong' }])
                    setTest(`✓ ${r.text.slice(0, 40)} (${Math.round(r.ms)} ms)`)
                  } catch (e) {
                    setTest(`✗ ${(e as Error).message}`)
                  }
                }}
              >
                {L('Test', '测试连接')}
              </button>
            </div>
            {test && <div className={`badge ${test.startsWith('✓') ? 'ok' : test === '…' ? '' : 'err'}`} style={{ whiteSpace: 'normal' }}>{test}</div>}
            <p className="faint tiny">
              {L(
                'Requests go directly from your browser to the provider; the key is kept in session storage unless “remember” is checked. Some providers block browser CORS — use a local proxy, Ollama or vLLM in that case.',
                '请求直接从浏览器发往模型服务；除非勾选“记住”，Key 只保存在会话存储中。部分服务商不允许浏览器跨域调用，可使用本地代理、Ollama 或 vLLM。',
              )}
            </p>
          </div>
        </Panel>
        <Panel title={L('Dataset format analysis', '数据集格式分析')}>
          <p className="small muted">
            {L(
              'Sends info.json, feature names / shapes / value ranges, the first frame, episode metadata and EmbodiScope’s own interpretation to the text model, and asks for the meaning, reference frame, rotation format and units of every signal plus training recommendations. No images, no raw episodes.',
              '把 info.json、特征名/维度/数值范围、首帧数值、episode 元数据以及本平台的推断结果发送给文本模型，让它解释每个信号的含义、参考系、旋转格式和单位，并给出训练建议。不会发送图像和完整数据。',
            )}
          </p>
          <button className="primary" disabled={!entry} onClick={() => entry && runFormatAnalysis(entry)}>
            🤖 {L('Analyse', '开始分析')} {entry?.ds.name}
          </button>
          {entry?.formatAnalysis && (
            <div style={{ marginTop: 10 }}>
              <Badge kind="ok">{L('result available in the Schema tab', '结果已在“语义结构”页展示')}</Badge>
              <p className="small">{entry.formatAnalysis.summary}</p>
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title={L('Subtask decomposition & captions (multimodal)', '子任务分解与 Caption 标注（多模态）')}
        actions={
          <>
            <button className="small" disabled={!Object.keys(annotations).length} onClick={exportJsonl}>
              ⬇ subtasks.jsonl
            </button>
            <button className="small" disabled={!Object.keys(annotations).length} onClick={exportEpisodesJsonl} title={L('LeRobot v2.1 episodes.jsonl with action_config (AgiBot style)', '带 action_config 的 LeRobot v2.1 episodes.jsonl（AgiBot 风格）')}>
              ⬇ episodes.jsonl
            </button>
          </>
        }
        className=""
      >
        {!entry ? (
          <div className="muted">{L('Select a dataset.', '请选择数据集。')}</div>
        ) : (
          <div className="col">
            <div className="row wrap">
              <label className="col">
                <span className="muted small">{L('Camera', '相机')}</span>
                <select value={cam} onChange={(e) => setCam(e.target.value)}>
                  {entry.sem.cameras.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name} ({c.mount})
                    </option>
                  ))}
                </select>
              </label>
              <label className="col">
                <span className="muted small">{L('Frames sent', '发送帧数')}</span>
                <input type="number" min={4} max={48} value={nFrames} onChange={(e) => setNFrames(Number(e.target.value))} style={{ width: 80 }} />
              </label>
              <label className="col">
                <span className="muted small">{L('Granularity', '粒度')}</span>
                <select value={gran} onChange={(e) => setGran(e.target.value as any)}>
                  <option value="coarse">{L('subtasks', '子任务')}</option>
                  <option value="fine">{L('atomic actions', '原子动作')}</option>
                </select>
              </label>
              <label className="col">
                <span className="muted small">{L('Episodes', '范围')}</span>
                <select value={scope} onChange={(e) => setScope(e.target.value as any)}>
                  <option value="current">{L('current episode', '当前 episode')}</option>
                  <option value="first10">{L('first 10', '前 10 个')}</option>
                  <option value="all">{L('all available', '全部')}</option>
                </select>
              </label>
              <label className="col">
                <span className="muted small">{L('Parallel requests', '并发数')}</span>
                <input type="number" min={1} max={8} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} style={{ width: 70 }} />
              </label>
              <label className="row small muted" style={{ alignSelf: 'flex-end' }}>
                <input type="checkbox" checked={useCues} onChange={(e) => setUseCues(e.target.checked)} /> {L('add gripper/motion cues', '附带夹爪/运动线索')}
              </label>
              <span className="spacer" />
              {progress && progress.done < progress.total ? (
                <button onClick={() => (cancel.current = true)}>{L('Stop', '停止')}</button>
              ) : (
                <button className="primary" disabled={!cam} onClick={runBatch} style={{ alignSelf: 'flex-end' }}>
                  ▶ {L('Annotate', '开始标注')}
                </button>
              )}
            </div>
            {progress && (
              <div>
                <div className="small">
                  {progress.done}/{progress.total} {progress.errors.length ? <Badge kind="err">{progress.errors.length} errors</Badge> : null}
                </div>
                <div className="progress">
                  <div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
                </div>
                {progress.errors.slice(-3).map((e, i) => (
                  <div key={i} className="tiny" style={{ color: 'var(--err)' }}>
                    {e}
                  </div>
                ))}
              </div>
            )}
            <div className="faint tiny">
              {L(
                'Frames are sampled uniformly and downscaled to 448 px; proprioceptive cues (gripper open/close, motion pauses) are added as text so boundaries line up with the data. Results show up as a timeline track in the Episode viewer and are saved in this browser.',
                '均匀采样帧并缩放到 448 像素；夹爪开合与运动停顿等本体线索以文本形式附带，使分段边界与数据对齐。结果会显示在片段可视化的时间轴中，并保存在本浏览器。',
              )}
            </div>
            <div style={{ maxHeight: 420, overflow: 'auto' }}>
              <table className="t">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{L('Caption', '描述')}</th>
                    <th>{L('Segments', '分段')}</th>
                    <th>{L('model', '模型')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(annotations).map(([ep, a]) => (
                    <tr key={ep}>
                      <td className="mono">
                        <a onClick={() => selectEpisode(Number(ep))} style={{ cursor: 'pointer' }}>
                          {ep}
                        </a>
                      </td>
                      <td className="small" style={{ maxWidth: 360 }}>
                        {a.caption}
                        {a.success != null && <Badge kind={a.success ? 'ok' : 'err'}>{a.success ? 'success' : 'fail'}</Badge>}
                      </td>
                      <td className="tiny">
                        {a.segments.map((s, i) => (
                          <div key={i}>
                            <span className="mono faint">
                              [{s.start}–{s.end})
                            </span>{' '}
                            {s.text}
                          </div>
                        ))}
                      </td>
                      <td className="tiny muted">{a.model}</td>
                      <td>
                        <button className="ghost small" onClick={() => setAnnotation(entry.id, Number(ep), null)}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}
