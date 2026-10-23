import { useStore } from './store'

export type Lang = 'zh' | 'en'

/** Inline bilingual strings keep translations next to the UI that uses them: L('Episodes', '片段'). */
export function useL() {
  const lang = useStore((s) => s.lang)
  return (en: string, zh: string) => (lang === 'zh' ? zh : en)
}

export function pick<T extends { en: string; zh: string }>(lang: Lang, v: T | undefined): string {
  return v ? v[lang] : ''
}

export const ROLE_LABEL: Record<string, [string, string]> = {
  camera: ['Camera', '相机'],
  depth: ['Depth', '深度'],
  joint_position: ['Joint position', '关节位置'],
  joint_velocity: ['Joint velocity', '关节速度'],
  joint_effort: ['Joint effort', '关节力矩'],
  joint_current: ['Joint current', '关节电流'],
  gripper: ['Gripper', '夹爪'],
  hand_joints: ['Dexterous hand', '灵巧手关节'],
  eef_pose: ['EEF pose', '末端位姿'],
  eef_position: ['EEF position', '末端位置'],
  delta_position: ['Δ position', '位置增量'],
  delta_rotation: ['Δ rotation', '旋转增量'],
  body_keypoint: ['Body / hand keypoint', '人体/手部关键点'],
  camera_intrinsics: ['Camera intrinsics', '相机内参'],
  camera_extrinsics: ['Camera extrinsics', '相机外参'],
  camera_distortion: ['Distortion', '畸变参数'],
  base_pose: ['Base pose', '底盘位姿'],
  base_velocity: ['Base velocity', '底盘速度'],
  head: ['Head', '头部'],
  torso: ['Torso / waist', '腰部/躯干'],
  position_2d: ['2D position', '二维位置'],
  label: ['Frame label', '帧级标签'],
  confidence: ['Confidence', '置信度'],
  reward: ['Reward', '奖励'],
  done: ['Done / terminate', '结束标志'],
  index: ['Index', '索引'],
  unknown: ['Unknown', '未知'],
}

export const EMBODIMENT_LABEL: Record<string, [string, string]> = {
  single_arm: ['Single arm', '单臂'],
  dual_arm: ['Dual arm', '双臂'],
  mobile_manipulator: ['Mobile manipulator', '移动操作'],
  humanoid: ['Humanoid / upper body', '人形/上半身'],
  human_hand: ['Human hands (egocentric)', '人手（第一视角）'],
  dexterous_hand: ['Dexterous hand', '灵巧手'],
  planar: ['Planar / 2D', '平面 / 2D'],
  unknown: ['Unknown', '未知'],
}

export const LEVEL_LABEL: Record<string, [string, string]> = {
  task: ['Task instruction', '任务指令'],
  episode_instruction: ['Per-episode instructions', '逐 episode 指令'],
  subtask_segments: ['Subtask segments', '子任务分段'],
  skill_labels: ['Skill labels', '技能标签'],
  frame_primitives: ['Frame-level primitives', '帧级原子标注'],
  scene_description: ['Scene description', '场景描述'],
  quality_flags: ['Quality / confidence', '质量/置信度'],
}

export function useLabel() {
  const lang = useStore((s) => s.lang)
  return (table: Record<string, [string, string]>, key: string) => {
    const v = table[key]
    return v ? v[lang === 'zh' ? 1 : 0] : key
  }
}
