import { useState } from 'react'
import { useL } from '@app/i18n'
import { HfHubSource } from '@core/io/httpSource'
import { openSource } from '@app/actions'
import { useStore } from '@app/store'
import { HF_EXAMPLES, useOpenFolder } from './OpenControls'

export function Welcome() {
  const L = useL()
  const { open, element } = useOpenFolder()
  const [over, setOver] = useState(false)
  const notify = useStore((s) => s.notify)
  const features: [string, string, string][] = [
    ['🧭', L('Auto format parsing', '自动格式解析'), L('LeRobot v2.0 / v2.1 / v3.0, nested folders of many datasets, sidecar annotations, per-episode metadata.', '支持 LeRobot v2.0 / v2.1 / v3.0、多数据集嵌套目录、附加标注文件与 episode 元数据。')],
    ['📐', L('Semantics & coordinate frames', '语义与坐标系推断'), L('Every vector is split into joints / EEF poses / grippers / cameras; rotation representation, quaternion order, units and reference frames are inferred.', '把每个向量拆解为关节 / 末端位姿 / 夹爪 / 相机，推断旋转表示、四元数顺序、单位和参考坐标系。')],
    ['🎥', L('Synchronised viewer', '多视角同步可视化'), L('Multi-camera video, 3D EEF / hand trajectories with oriented axes, camera frustums, projection overlays, subtask timeline and signal plots.', '多相机视频、带方向坐标轴的末端/手部 3D 轨迹、相机视锥、投影叠加、子任务时间轴与信号曲线。')],
    ['🩺', L('Quality checks', '数据质量检测'), L('Timestamps, dropped frames, idle segments, spikes, quaternion flips, action–state lag, codecs, missing files.', '时间戳、丢帧、静止段、动作跳变、四元数翻转、动作-状态延迟、视频编码、缺失文件。')],
    ['⚖️', L('Dataset comparison', '数据集差异对比'), L('Embodiment, action space, frames, rotation format, fps, resolution, annotation granularity side by side.', '本体、动作空间、坐标系、旋转格式、帧率、分辨率、标注精细度并排对比。')],
    ['🤖', L('LLM / VLM assistant', '大模型辅助'), L('Bring your own API key: schema analysis, subtask decomposition and captions with multimodal models, exportable annotations.', '接入自己的 API Key：格式分析、多模态子任务分解与 caption 标注，标注可导出。')],
  ]
  return (
    <div style={{ maxWidth: 1080, margin: '24px auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <h1 style={{ fontSize: 30, letterSpacing: '-.02em' }}>EmbodiScope</h1>
        <p className="muted" style={{ fontSize: 15, marginTop: 6 }}>
          {L(
            'Understand your robot-learning data before you train on it. Runs entirely in your browser — data never leaves your machine.',
            '在训练之前真正看懂你的具身数据。完全在浏览器本地运行，数据不会离开你的电脑。',
          )}
        </p>
      </div>
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}
      >
        <div style={{ fontSize: 34 }}>📂</div>
        <h2 style={{ margin: '8px 0' }}>{L('Drop a dataset folder here', '把数据集文件夹拖到这里')}</h2>
        <p className="muted">
          {L(
            'A single LeRobot dataset or a parent folder containing many — every meta/info.json is discovered.',
            '可以是单个 LeRobot 数据集，也可以是包含多个数据集的父目录 —— 会自动发现所有 meta/info.json。',
          )}
        </p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
          <button className="primary" onClick={open}>
            {L('Choose folder', '选择文件夹')}
          </button>
        </div>
        <div className="row wrap" style={{ justifyContent: 'center', marginTop: 16, gap: 6 }}>
          <span className="muted small">{L('or try a public dataset:', '或者试试公开数据集：')}</span>
          {HF_EXAMPLES.map((r) => (
            <span
              key={r}
              className="chip"
              onClick={async () => {
                try {
                  await openSource(await HfHubSource.open(r))
                } catch (e) {
                  notify((e as Error).message, 'error')
                }
              }}
            >
              🤗 {r}
            </span>
          ))}
        </div>
        {element}
      </div>
      <div className="grid g3" style={{ marginTop: 24 }}>
        {features.map(([ico, t, d]) => (
          <div key={t} className="feature-card">
            <div className="ico">{ico}</div>
            <h3 style={{ margin: '6px 0 4px' }}>{t}</h3>
            <div className="muted small">{d}</div>
          </div>
        ))}
      </div>
      <p className="faint small" style={{ textAlign: 'center', marginTop: 24 }}>
        {L(
          'Tip: Chrome / Edge give the best experience (folder access + AV1 decoding). Shortcuts: Space play/pause · ←/→ frame · Shift+←/→ 10 frames · [ / ] previous / next episode.',
          '提示：推荐 Chrome / Edge（支持文件夹访问与 AV1 解码）。快捷键：空格 播放/暂停 · ←/→ 单帧 · Shift+←/→ 10 帧 · [ / ] 上/下一个 episode。',
        )}
      </p>
    </div>
  )
}
