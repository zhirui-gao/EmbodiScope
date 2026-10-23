import { useL } from '@app/i18n'
import { Modal } from './common'

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const L = useL()
  return (
    <Modal title={L('Guide', '使用指南')} onClose={onClose} wide>
      <div className="grid g2">
        <div className="col">
          <h3>{L('Workflow', '推荐流程')}</h3>
          <ol className="small" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.8 }}>
            <li>{L('Open a local folder (or a Hugging Face repo). All datasets inside are discovered.', '打开本地文件夹（或 Hugging Face 仓库），自动发现其中所有数据集。')}</li>
            <li>{L('Overview: size, fps, cameras, state/action composition, annotation granularity.', '数据概览：规模、帧率、相机、状态/动作构成、标注精细度。')}</li>
            <li>{L('Schema & frames: verify inferred roles, rotation formats, units and the TF tree; correct them — corrections are remembered.', '语义结构：核对推断出的信号角色、旋转格式、单位与坐标系树并修正，修正会被记住。')}</li>
            <li>{L('Episode viewer: watch videos with 3D poses and projected axes to validate conventions visually.', '片段可视化：结合视频、3D 位姿与投影坐标轴直观验证约定是否正确。')}</li>
            <li>{L('Quality: run a full scan for timing, idle, spikes, action–state lag and video checks.', '质量检测：全量扫描时间戳、静止段、跳变、动作-状态延迟与视频问题。')}</li>
            <li>{L('Compare: line datasets up to spot convention and coverage differences before mixing them.', '数据集对比：混合训练前并排查看约定与覆盖差异。')}</li>
            <li>{L('AI lab: LLM schema analysis, VLM subtask decomposition & captions; export JSONL.', 'AI 标注：大模型格式分析、多模态子任务分解与 caption，导出 JSONL。')}</li>
          </ol>
          <h3 style={{ marginTop: 12 }}>{L('Keyboard', '快捷键')}</h3>
          <div className="kv">
            <span>Space</span>
            <span>{L('play / pause', '播放 / 暂停')}</span>
            <span>← / →</span>
            <span>{L('previous / next frame', '上一帧 / 下一帧')}</span>
            <span>Shift + ← / →</span>
            <span>{L('±10 frames', '±10 帧')}</span>
            <span>[ / ]</span>
            <span>{L('previous / next episode', '上一个 / 下一个 episode')}</span>
            <span>Home / End</span>
            <span>{L('first / last frame', '首帧 / 末帧')}</span>
          </div>
        </div>
        <div className="col">
          <h3>{L('Reading the 3D view', '如何阅读 3D 视图')}</h3>
          <p className="small">
            <span className="legend-axis">
              <b>X</b>
              <b>Y</b>
              <b>Z</b>
            </span>{' '}
            {L(
              'Axes are always red = X, green = Y, blue = Z (RGB = XYZ). The large triad is the reference frame; small triads are end-effectors / hands; ghost triads show orientation along the trajectory. Camera frustums use the declared optical convention (OpenCV: Z forward, Y down).',
              '坐标轴统一为 红 = X、绿 = Y、蓝 = Z（RGB = XYZ）。大坐标系是参考系，小坐标系是末端 / 手腕，半透明坐标系显示沿轨迹的姿态变化。相机视锥按声明的光学约定绘制（OpenCV：Z 向前，Y 向下）。',
            )}
          </p>
          <p className="small">
            {L(
              'Projection overlay: when a camera has intrinsics and extrinsics in the same frame as the poses, EEF axes are projected into the video. If the projected axes do not sit on the gripper, the frame, quaternion order or extrinsic direction is wrong.',
              '投影叠加：当相机具有内外参且与位姿处于同一参考系时，末端坐标轴会投影到视频上。如果投影没有落在夹爪上，说明参考系、四元数顺序或外参方向有误。',
            )}
          </p>
          <h3>{L('Run locally', '本地运行')}</h3>
          <p className="small">
            {L('Double-click the single-file build ', '直接双击单文件版 ')}
            <code>embodiscope.html</code>
            {L(', or serve the folder: ', '，或在目录下启动静态服务：')}
            <code>python -m http.server</code> / <code>serve.bat</code>.{' '}
            {L('Everything runs client-side; API keys are only sent to the provider you configure.', '所有计算在本地浏览器完成；API Key 只发送给你配置的模型服务。')}
          </p>
        </div>
      </div>
    </Modal>
  )
}
