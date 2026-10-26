# 评审与路线图 / Review & roadmap

本文从两个视角审视 EmbodiScope：一是具身数据 / 机器人学习领域的研究者，二是产品与可用性。表中「状态」列中的 ✅ 表示已实现，⏳ 表示规划中。

## 领域专家视角：可视化与分析还缺什么

| # | 缺口 | 为什么重要 | 状态 |
|---|---|---|---|
| D1 | **机器人运动学模型**（URDF + 正运动学） | ALOHA、SO-101、RoboTwin（关节版）等只有关节角的数据，没有模型就看不到机器人在 3D 中的姿态，也无法交叉验证末端位姿 | ✅ 已实现 URDF 骨架（关节按名称 / 顺序自动匹配，支持 mimic 关节）；⏳ 网格渲染、与末端位姿的一致性自动检查 |
| D2 | **Action chunk 可视化** | ACT / Diffusion Policy / π0 监督的是未来 H 步，需要直观看到 chunk 覆盖的运动范围 | ✅ 3D 中高亮未来 H 步，曲线上显示同一窗口；⏳ 增量动作按控制器尺度积分预览 |
| D3 | **GR00T `modality.json`、rot6d、轴角、`q1..q4` 命名** | RoboCasa-GR1、GR00T-X-Embodiment、openwam 的 rot6d 统一空间都依赖这些约定 | ✅ |
| D4 | **主流数据集的约定库**（LIBERO、RoboCasa、RoboTwin、DROID、RT-1、PushT） | 只有维度数、没有维度名时，只能依靠文档中的约定 | ✅ 已有 6 个配置；⏳ 社区贡献更多（BridgeData、Language-Table、BEHAVIOR、Galaxea、AgiBot 新版等） |
| D5 | **原始格式**：HDF5（robomimic / LIBERO / RoboTwin 原始版 / ACT）、RLDS / TFDS（OXE）、Zarr（Diffusion Policy） | 很多基准数据并不以 LeRobot 格式发布 | ⏳ 计划用 h5wasm 支持 HDF5；RLDS 需要 TFRecord 解析 |
| D6 | **数据集级分布**：逐维动作直方图、状态-动作覆盖、按任务分组的分布 | 归一化方式选择、长尾与外推风险评估 | ⏳（目前有逐维 min/max/均值±标准差） |
| D7 | **相似 / 重复 episode、离群 episode 检测**（DTW / 嵌入） | 数据去重、自动挑出异常演示 | ⏳ |
| D8 | **归一化方案预览与导出**（min-max / z-score / 分位数；导出 LeRobot stats、openpi norm_stats） | 直接产出训练配置 | ⏳ |
| D9 | **相机标定自动检验**：重投影一致性评分、多相机时间同步漂移 | 目前依赖人眼看投影叠加 | ⏳ |
| D10 | **跨数据集统一**：变换到公共基坐标系、生成统一动作空间映射（类似 openwam 80 维 unify map） | 混合训练的核心工作量 | ⏳（对比页已生成需要统一的事项清单） |
| D11 | **语言**：指令改写多样性、嵌入聚类、子任务词表统计 | 语言条件策略的泛化 | ⏳ |
| D12 | **成功 / 失败标签、奖励** | 过滤失败演示、离线 RL | 部分：显示 `next.reward` / `next.success`；⏳ 专门视图 |

## 产品专家视角：效率、可用性与流程

| # | 不足 | 影响 | 状态 |
|---|---|---|---|
| P1 | 缺少完整的使用说明 | 新用户上手成本高 | ✅ 「使用说明」页，支持中英文切换、目录与搜索；同一份 Markdown 也可以在 GitHub 上直接阅读 |
| P2 | 刷新后丢失位置，无法分享 | 协作低效 | ✅ URL 记录数据集 / 页面 / episode / 帧 |
| P3 | 每次都要重新质量扫描 | 大数据集浪费时间 | ✅ 扫描结果缓存在 IndexedDB，数据变化时自动失效 |
| P4 | 不能标记 episode，也不能导出筛选结果 | 数据清洗没有最终交付物 | ✅ 保留 / 剔除 / 待复查（G/B/R 快捷键）、备注、按标记或问题筛选、导出 keep / exclude / flags 文件、按问题批量标记 |
| P5 | AI 标注结果不能修改 | 无法人工校正 | ✅ 标注编辑器：拆分、合并、移动边界、改文字 |
| P6 | 一次渲染几十张曲线 | 大数据集卡顿 | ✅ 曲线进入视口时才创建 |
| P7 | 窗口变窄时布局拥挤 | 笔记本 / 分屏不可用 | ✅ 响应式断点 |
| P8 | 加载数据后强制跳回概览页 | 打断用户 | ✅ 已修复 |
| P9 | 包体积 1.3 MB、未拆分 | 首屏慢 | ⏳ 按页面拆分 three.js / uPlot |
| P10 | 不能直接重新打开最近的文件夹 | 每次都要重新选择 | ⏳ 把 FileSystemHandle 存入 IndexedDB |
| P11 | 浏览器无法解码 FMP4 / HEVC | 部分数据看不到视频 | ⏳ WebCodecs / ffmpeg.wasm 兜底 |
| P12 | 没有端到端 UI 测试 | 回归风险 | ⏳ Playwright 冒烟测试 |
| P13 | 多人协作标注（共享标记 / 标注） | 团队清洗数据 | ⏳ 通过 `serve.mjs` 写回 sidecar 文件 |

## 已测试的数据集（共 23 个）

- **LeRobot v2.0**：physical-intelligence/libero（图像内嵌 parquet）、GR00T GR1 CupToDrawer、GR00T-X-Embodiment-Sim gr1_arms_only.CanSort。
- **LeRobot v2.1**：AgiBot World ×2、EgoDex ×2、InternData-A1 ×2、OpenX RT-1、RoboCoIN ×2、RoboMIND、IPEC LIBERO-10、RoboTwin EEF（robbyant）。
- **LeRobot v3.0**：ALOHA sim、DROID-100、PushT、SO-101、lerobot/libero、lerobot/robotwin_unified、lerobot/robocasa_target_human_unified、OpenMOSS RoboCasa365。
