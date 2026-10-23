import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'

/**
 * Integration tests run against real datasets on disk when available.
 * Configure roots with env EMBODISCOPE_DATASETS (path-delimited) or tests/.local-datasets.json (["C:/data", ...]).
 */
export function localDatasetRoots(): string[] {
  const env = process.env.EMBODISCOPE_DATASETS
  let roots: string[] = []
  if (env) roots = env.split(path.delimiter)
  else {
    const cfg = path.join(path.dirname(fileURLToPath(import.meta.url)), '.local-datasets.json')
    if (existsSync(cfg)) roots = JSON.parse(readFileSync(cfg, 'utf8'))
  }
  return roots.filter((r) => existsSync(r))
}
