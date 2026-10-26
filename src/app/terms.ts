import { useStore } from './store'

/**
 * Chinese renderings of enumerated values and fixed phrases produced by the analysis core
 * (which stays language-neutral English). Unknown strings — field names, instructions, file
 * paths — are shown unchanged.
 */
const ZH: Record<string, string> = {
  // embodiment / end effector
  single_arm: '单臂',
  dual_arm: '双臂',
  mobile_manipulator: '移动操作',
  humanoid: '人形',
  human_hand: '人手',
  dexterous_hand: '灵巧手',
  planar: '平面 / 2D',
  parallel_gripper: '平行夹爪',
  none: '无',
  unknown: '未知',
  'mobile base': '移动底盘',
  // camera mounts / conventions
  head: '头部',
  wrist: '腕部',
  third_person: '第三人称',
  egocentric: '第一视角',
  opencv: 'OpenCV',
  opengl: 'OpenGL',
  ros_body: 'ROS 机体系',
  // streams
  observation: '观测',
  action: '动作',
  teleop: '遥操作',
  label: '标签',
  meta: '元数据',
  index: '索引',
  other: '其他',
  // sides
  left: '左',
  right: '右',
  center: '中',
  // action space / type
  absolute: '绝对',
  delta: '增量',
  velocity: '速度',
  'joint position': '关节位置',
  'EEF pose': '末端位姿',
  'joint + EEF pose': '关节 + 末端位姿',
  'EEF delta / velocity': '末端增量 / 速度',
  '2D position': '二维位置',
  // gripper
  open_high: '1 = 张开',
  closed_high: '1 = 闭合',
  '1 = open': '1 = 张开',
  '1 = closed': '1 = 闭合',
  open: '张开',
  closed: '闭合',
  // QA
  error: '错误',
  warning: '警告',
  info: '提示',
  structure: '结构',
  timing: '时序',
  signal: '信号',
  video: '视频',
  annotation: '标注',
  convention: '约定',
  // scan status
  running: '扫描中',
  done: '已完成',
  cancelled: '已取消',
  // timeline tracks
  'subtasks (metadata)': '子任务（元数据）',
  'auto (gripper/motion)': '自动分段（夹爪/运动）',
  gripper: '夹爪',
  'left gripper': '左夹爪',
  'right gripper': '右夹爪',
  // heuristic segments
  'approach / reach': '接近 / 伸向目标',
  'grasp & move': '抓取并移动',
  'left grasp & move': '左手抓取并移动',
  'right grasp & move': '右手抓取并移动',
  'grasp & move (bimanual hold)': '抓取并移动（双手持握）',
  'release & reposition': '释放并调整',
  'left release & reposition': '左手释放并调整',
  'right release & reposition': '右手释放并调整',
  retreat: '撤回',
  'whole episode': '整段',
  // embodiment evidence
  'left and right arm signals': '同时存在左右臂信号',
  'mobile base pose / velocity': '底盘位姿 / 速度在变化',
  'head joints': '头部关节',
  'waist / torso joints': '腰部 / 躯干关节',
  'dexterous hand joints': '灵巧手关节',
  'single arm signals': '单臂信号',
  '2D position state': '二维位置状态',
  implicit: '隐式',
}

/** English display names for internal snake_case codes. */
const EN: Record<string, string> = {
  single_arm: 'Single arm',
  dual_arm: 'Dual arm',
  mobile_manipulator: 'Mobile manipulator',
  humanoid: 'Humanoid',
  human_hand: 'Human hands',
  dexterous_hand: 'Dexterous hand',
  planar: 'Planar / 2D',
  parallel_gripper: 'Parallel gripper',
  third_person: 'Third person',
  egocentric: 'Egocentric',
  ros_body: 'ROS body',
  open_high: '1 = open',
  closed_high: '1 = closed',
}

export function term(lang: 'zh' | 'en', s: string | undefined | null): string {
  if (s == null) return ''
  if (lang !== 'zh') {
    if (EN[s]) return EN[s]
    return / [/+] /.test(s) ? s.split(/( [/+] )/).map((p, i) => (i % 2 ? p : EN[p.trim()] ?? p)).join('') : s
  }
  if (ZH[s]) return ZH[s]
  const m = s.match(/^motion segment (\d+)$/)
  if (m) return `运动片段 ${m[1]}`
  // "a / b" or "a + b" composites of known terms
  if (/ [/+] /.test(s)) {
    const parts = s.split(/( [/+] )/)
    if (parts.every((p, i) => i % 2 === 1 || ZH[p.trim()])) return parts.map((p, i) => (i % 2 ? p : ZH[p.trim()])).join('')
  }
  return s
}

export function useTerm() {
  const lang = useStore((s) => s.lang)
  return (s: string | undefined | null) => term(lang, s)
}
