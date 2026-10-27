# EmbodiScope 具身数据检测平台

**在训练之前，真正看懂你的具身数据。**
EmbodiScope 是一个运行在浏览器中的具身智能数据检测、质量控制、对比与标注平台，支持 [LeRobot](https://github.com/huggingface/lerobot) v2.0 / v2.1 / v3.0 格式。所有计算都在本地浏览器完成，数据不会离开你的电脑。

**▶ 在线使用：<https://zhirui-gao.github.io/EmbodiScope/>** —— 打开网页后选择本地文件夹（或 Hugging Face 仓库）即可，数据不会上传。
离线使用：从 [最新 Release](https://github.com/zhirui-gao/EmbodiScope/releases/latest) 下载 `embodiscope.html`，双击打开。

[English →](README.md)

## 为什么需要它

具身领域普遍混合多个数据集训练（OXE、AgiBot World、DROID、RoboMIND、EgoDex、InternData、RoboCoIN……），但每个数据集描述世界的方式都不同：四元数 `xyzw` 还是 `wxyz`、RPY 还是旋转向量、位姿相对于 `robot` / `armbase` / `odom` / `world`、夹爪 `1` 表示张开还是闭合、动作是绝对目标、增量、归一化速度——甚至直接等于当前状态。这些差异会悄无声息地破坏训练效果，EmbodiScope 把它们全部可视化出来。

## 功能

- **自动格式解析**：递归发现目录下所有 `meta/info.json`；支持 v2.x（逐 episode 文件）与 v3.0（多 episode 拼接文件，按元数据偏移定位）；解析附加标注（`annotations/*.jsonl`）、`info.yaml`、README 以及 episode 级扩展字段（AgiBot `action_config`、EgoDex `joint_confidence`、RoboMIND `action_semantics` 等）。
- **语义推断**：将每个向量拆解为关节 / 末端位姿 / 夹爪 / 灵巧手 / 头部 / 腰部 / 底盘 / 相机；推断旋转表示、四元数顺序、单位（m/mm、rad/deg/归一化）、夹爪极性、由 `<child>_to_<parent>_pose` 命名得到的参考坐标系树、动作与状态的配对关系、绝对/增量动作和本体类型。对未命名向量按数值范围兜底，对有文档约定的数据集（RT-1、DROID、PushT 等）使用配置文件修正。所有推断都可在界面中编辑、持久化，并导出为 `embodispec.json`。
- **同步可视化**：多相机视频 + 3D 场景，末端轨迹带 RGB（= XYZ）方向坐标轴、沿轨迹的姿态残影、动作目标、由内外参绘制的相机视锥、人手/人体骨架。**投影叠加**利用标定把末端坐标轴和手部骨架画到视频上，这是验证坐标系与四元数顺序是否正确的最快方法。另外还有子任务 / 帧级标签 / 夹爪状态时间轴、信号曲线（实线为观测、虚线为配对动作）、帧数值检查器和快捷键。
- **质量检测**：用 Web Worker 并行扫描所有 episode，检查时间戳单调性、丢帧、采样抖动、frame_index 连续性、NaN/Inf、首尾静止段、静止 episode、动作跳变、四元数归一化与符号翻转、欧拉角 ±π 跳变、**动作-状态时间延迟**（例如 ALOHA ≈ 2 帧、SO-101 ≈ 4 帧，AgiBot / RoboCoIN 的动作与当前状态完全相同），并解析 MP4 头部信息（编码、帧数、fps、与数据长度是否一致、浏览器能否解码）。
- **数据集对比**：并排对比表并高亮差异，自动生成“混合训练前需要统一的事项”清单，叠加显示时长分布与末端工作空间，可导出 Markdown / CSV / JSON。
- **AI 标注（自带 API Key）**：支持 OpenAI 兼容接口（OpenAI、通义千问 DashScope、DeepSeek、智谱 GLM、Kimi、硅基流动、OpenRouter、Ollama、vLLM）、Anthropic 和 Gemini。
  - **格式分析**：由大模型解释数据结构，结果可一键应用到语义推断。
  - **子任务分解与 caption 标注**：多模态模型读取均匀采样帧，并附带夹爪/运动等本体线索；支持批量标注，可导出为 JSONL，或带 `action_config` 的 LeRobot v2.1 `episodes.jsonl`。
  - 另外内置一个无需训练的启发式分段，没有 API Key 也能用。
- **多种数据源**：本地文件夹、拖拽、Hugging Face Hub（Range 请求，只下载实际查看的部分）、HTTP，以及零依赖的 Node 数据服务（`scripts/serve.mjs`），适合数据放在远程服务器上的场景。
- **分析报告**：一键导出数据集 Markdown 报告。

## 快速开始

**方式 A：单文件 HTML（免安装）**。把仓库根目录的 `embodiscope.html` 拷到任何电脑上，双击打开，选择文件夹或直接把文件夹拖进页面。推荐使用 Chrome / Edge（支持文件夹访问与 AV1 解码）。修改代码后可以用 `npm run release` 重新生成这个文件。

**方式 B：在线版**。使用本仓库的 GitHub Pages 页面，数据依然只在本地处理。

**方式 C：数据在服务器上 / 目录很大**：

```bash
node scripts/serve.mjs /path/to/datasets --port 8686    # 需要 Node >= 18，无需 npm install
# 浏览器打开 http://localhost:8686（远程 GPU 机器可用 ssh -L 8686:localhost:8686 转发）
```

Windows 下可以直接运行 `serve.bat D:\datasets`。新 clone 的仓库不需要 `npm install` 和构建，数据服务会直接使用 `embodiscope.html`。加上 `--host 0.0.0.0` 可以让局域网内的同事访问，但这会把数据目录开放给整个局域网。

**方式 D：开发**：

```bash
npm install
EMBODISCOPE_DATA=/path/to/datasets npm run dev
npm test
npm run build && npm run build:single
```

URL 参数：`?hf=lerobot/pusht` 直接打开 Hub 数据集；`?server=http://host:8686` 连接远程数据服务。

## 推荐流程

1. **数据概览**：查看规模、帧率、相机、状态/动作构成和标注精细度。
2. **语义结构**：核对信号角色、旋转格式、单位与坐标系树，有误时直接修正，修正会被记住。
3. **片段可视化**：用投影叠加和 3D 视图直观验证约定。
4. **质量检测**：全量扫描并定位问题 episode。
5. **数据集对比**：混合训练前对齐各数据集的约定。
6. **AI 标注**：补齐子任务与 caption，导出后用于分层策略或 VLA 训练。

## 已测试的数据集（23 个）

- **v2.0**：physical-intelligence/libero（图像内嵌 parquet）、GR00T GR1（RoboCasa-GR1，带 `modality.json`）、GR00T-X-Embodiment-Sim gr1_arms_only。
- **v2.1**：AgiBot World、EgoDex（人手）、InternData-A1（Franka / ARX Lift-2）、Open X-Embodiment RT-1、RoboCoIN（灵巧手）、RoboMIND（16 位深度）、IPEC LIBERO-10、RoboTwin 2.0 EEF。
- **v3.0**：ALOHA sim、DROID-100、PushT、SO-101（含 URDF）、lerobot/libero、lerobot/robotwin_unified、lerobot/robocasa_target_human_unified、OpenMOSS RoboCasa365。

平台内的「使用说明」页（中 / 英）直接渲染自 [docs/guide](docs/guide)。已知不足与规划见 [docs/ROADMAP.md](docs/ROADMAP.md)。

## 扩展开发

见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)（如何新增数据集配置、质量检查、模型服务商或页面），以及 [docs/DATA_CONVENTIONS.md](docs/DATA_CONVENTIONS.md)（具身数据需要关注的问题及原因）。

## 许可证

Apache-2.0
