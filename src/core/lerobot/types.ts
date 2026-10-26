import type { FileSource } from '../io/source'

export type CodebaseVersion = 'v1.x' | 'v2.0' | 'v2.1' | 'v3.0' | string

export interface FeatureSpec {
  key: string
  dtype: string
  shape: number[]
  /** flattened per-dim names (length == product(shape) for vectors) or null when absent */
  names: string[] | null
  /** names exactly as written in info.json (list, dict like {"motors": [...]}, nested lists, null) */
  rawNames: unknown
  info?: Record<string, unknown>
  isVideo: boolean
  isImage: boolean
  /** product of shape for non-visual features */
  dim: number
}

export interface FeatureStats {
  min?: number[]
  max?: number[]
  mean?: number[]
  std?: number[]
  count?: number
  q01?: number[]
  q99?: number[]
}

export interface VideoRef {
  path: string
  /** seconds inside the file where this episode starts (v3 concatenated videos); 0 for v2 */
  fromTimestamp: number
  toTimestamp?: number
}

export interface EpisodeInfo {
  index: number
  length: number
  tasks: string[]
  /** data file relative to dataset root */
  dataPath: string
  /** rows of this episode inside dataPath (v3 files hold many episodes) */
  rowStart: number
  rowEnd: number
  videos: Record<string, VideoRef>
  /** any extra per-episode metadata (AgiBot action_config, EgoDex joint_confidence, RoboMIND action_semantics …) */
  extra: Record<string, unknown>
  stats?: Record<string, FeatureStats>
  /** false when the data file is missing from the source (partial downloads / sampled subsets) */
  available: boolean
}

export interface TaskInfo {
  index: number
  text: string
}

/** Sidecar label vocabularies (e.g. RoboCoIN annotations/*.jsonl: index -> text). */
export interface LabelVocabulary {
  name: string
  file: string
  /** frame-level column using this vocabulary, when known */
  column?: string
  labels: Map<number, string>
}

/** GR00T-style meta/modality.json: named slices of state / action vectors. */
export interface ModalityGroup {
  name: string
  /** feature key holding the slice */
  key: string
  start: number
  end: number
  absolute?: boolean
  rotationType?: string
}

export interface DatasetExtras {
  vocabularies: LabelVocabulary[]
  modality?: { state: ModalityGroup[]; action: ModalityGroup[]; raw: unknown }
  /** free-form metadata files found next to meta/ (info.yaml, README.md, conversion reports …) */
  documents: { path: string; text: string }[]
  /** files at dataset root that are not part of the standard layout */
  sidecarFiles: string[]
}

export interface LeRobotDataset {
  /** stable id: label of source + root path */
  id: string
  name: string
  root: string
  source: FileSource
  version: CodebaseVersion
  info: Record<string, any>
  fps: number
  robotType: string
  features: FeatureSpec[]
  tasks: TaskInfo[]
  episodes: EpisodeInfo[]
  stats: Record<string, FeatureStats> | null
  extras: DatasetExtras
  warnings: string[]
  /** total size in bytes of files under the dataset root, when the source can list */
  totalBytes?: number
  loadMs: number
}

export const VIDEO_DTYPES = new Set(['video'])
export const IMAGE_DTYPES = new Set(['image'])
export const INDEX_KEYS = new Set(['timestamp', 'frame_index', 'episode_index', 'index', 'task_index'])
