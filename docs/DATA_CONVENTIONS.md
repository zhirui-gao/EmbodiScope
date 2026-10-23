# 具身数据需要关注什么 / What to check in embodied data

本文总结了训练策略模型（BC / Diffusion Policy / ACT / VLA / world model）前，研究者应该检查的数据问题。同时列出了 EmbodiScope 对应的功能，以及在 14 个公开/内部数据集上的实测发现。

## 1. 坐标系与位姿表示 · Frames & pose representation

| 问题 | 为什么重要 | EmbodiScope |
|---|---|---|
| 位姿相对于哪个参考系（`robot` / `armbase` / `odom` / `world` / 相机） | 混合数据时必须先统一到同一个基座系；双臂数据可能左右臂各有一个 armbase | 根据 `<child>_to_<parent>_pose` 命名生成 TF 树，3D 视图可切换参考系 |
| 旋转表示：四元数 `xyzw` / `wxyz`、RPY（外旋 xyz）/ 内旋 / 旋转向量 / 6D / 矩阵 | 顺序搞错仍能"正常训练"，但姿态全错；欧拉角在 ±π 处跳变，四元数存在 q 与 −q 的双覆盖 | 依据命名、`convention` 声明、数据集配置和数值范围推断；有歧义时标出，可手动切换并立即在 3D/投影中验证 |
| 光学坐标系约定（OpenCV：x 右、y 下、z 前；OpenGL；ROS body） | 投影、点云、相机外参都依赖它 | 相机视锥与投影叠加按约定绘制 |
| 单位（m / mm，rad / deg / LeRobot ±100 归一化） | 归一化统计和动作缩放会被放大 1000 倍 | 依据命名后缀与数值范围推断 |
| 外参方向（camera→robot 还是 robot→camera） | 方向反了，投影会落在画面外 | 投影叠加：坐标轴落在夹爪上才是对的 |

**实测：** AgiBot / EgoDex / OpenX-RT1 用 `xyzw`，InternData-A1 用 `wxyz`，RoboMIND 末端用 `x,y,z,r,p,y`，RoboCoIN 的 `eef_sim_pose` 只写了 `rot_x/y/z`（欧拉角还是旋转向量无法确定），DROID 的 `motor_0..6` 实际是 xyz + 欧拉角 + 夹爪。EgoDex 和 AgiBot 的末端/人手投影与视频严格对齐，说明外参与四元数顺序都正确。

## 2. 动作语义 · Action semantics

| 问题 | 为什么重要 | EmbodiScope |
|---|---|---|
| 绝对目标 / 增量 / 速度 / 归一化速度 | 决定动作头的设计和归一化方式 | 依据命名、统计量和配置推断，可手动修改 |
| 动作与状态的时间关系（action[t] ≈ state[t+k]） | 决定 action chunk 的对齐方式；k 即控制延迟 | 质量扫描中逐 episode 估计最佳延迟 |
| action == state（直接复制） | 监督目标不含未来信息，必须平移后再训练 | 检测为警告 |
| 夹爪指令与夹爪状态的量纲/极性不同 | 例如 openness ∈ [0,1] 与开口宽度 ∈ [0, 0.12] m | 检测并标出量程差异；极性可修正 |
| 关节空间与末端空间并存、遥操作主手 (`master_actions`) | 需要选定监督信号 | 按 stream 区分 observation / action / teleop |

**实测：** AgiBot 与 RoboCoIN 的关节动作和末端动作与当前状态逐帧相同；InternData 与 EgoDex 的动作是下一帧状态（延迟 1 帧）；ALOHA 约 2–3 帧（约 40–60 ms）；SO-101 约 4 帧（约 130 ms）；DROID 的动作是 [-1,1] 归一化的笛卡尔速度。

## 3. 时间与同步 · Timing

时间戳单调性、丢帧与跳变、采样抖动、`frame_index` 连续性、视频帧数与数据行数是否一致、视频 fps 与数据 fps 是否一致、v3 拼接视频的时间偏移。以上全部由质量扫描与 MP4 头部解析覆盖。

**实测：** OpenX fractal 只有 3 fps（策略频率差异极大）；老版 EgoDex 使用 `FMP4`（MPEG-4 Part 2）编码，浏览器和多数基于 torchcodec 的加载器都无法解码。

## 4. 信号质量 · Signal quality

首尾静止段（会让策略学会"等待"）、几乎没有运动的 episode、动作尖峰（遥操作抖动、IK 翻转）、NaN/Inf、常量维度、四元数未归一化、异常短的 episode。质量扫描会给出逐 episode 指标，点击即可跳转查看。

## 5. 语言与标注精细度 · Language & annotation granularity

EmbodiScope 将标注分为以下层级，并给出 0–5 的精细度评分：

1. 任务级指令（全数据集一条）
2. 逐 episode 指令
3. 子任务分段（AgiBot `action_config`、RoboCoIN `subtask_annotation`）
4. 技能 / 帧级原子标注（RoboCoIN 的运动方向、速度、夹爪模式）
5. 场景描述、质量/置信度标记

同时统计指令长度、词表大小和不同指令数。只有一条指令的数据集，语言条件不携带任何信息，可以用 AI 标注补充子任务与 caption。

## 6. 视觉 · Vision

相机数量与安装位置（头部 / 腕部 / 第三人称）、分辨率与宽高比、编码（AV1 / H.264 / HEVC / MPEG-4）、是否有内外参、深度图存储方式（RoboMIND 把 16 位 PNG 内嵌在 parquet 中）。混合数据时需要考虑相机 dropout 与分辨率统一策略。

## 7. 本体与覆盖 · Embodiment & coverage

本体类型（单臂 / 双臂 / 人形 / 移动 / 灵巧手 / 人手）、底盘是否真的移动（InternData 的 `robot_to_env_pose` 在 episode 内恒定，因此不算移动平台）、末端工作空间覆盖、episode 时长分布、任务分布。对比页会叠加显示多个数据集的工作空间与时长分布。

## 混合训练检查清单 · Co-training checklist

对比页会自动生成以下检查项：帧率、四元数顺序、旋转表示、动作空间、绝对/增量、夹爪极性、单位、参考系、相机数量、分辨率、本体类型、子任务标注覆盖。
