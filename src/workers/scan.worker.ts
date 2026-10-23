/// <reference lib="webworker" />
import { runScanJob } from '@core/analysis/scanJob'
import type { ScanConfig, ScanJob } from '@core/analysis/scanJob'

let cfg: ScanConfig | null = null

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as { type: 'config'; cfg: ScanConfig } | { type: 'job'; id: number; job: ScanJob }
  if (msg.type === 'config') {
    cfg = msg.cfg
    return
  }
  if (!cfg) return
  const result = await runScanJob(msg.job, cfg)
  ;(self as unknown as Worker).postMessage({ type: 'result', id: msg.id, result })
}
