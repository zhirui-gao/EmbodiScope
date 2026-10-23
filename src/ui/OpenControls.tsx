import { useRef, useState } from 'react'
import { FileListSource, hasDirectoryPicker, pickDirectory } from '@core/io/browserSources'
import { HfHubSource, HttpSource } from '@core/io/httpSource'
import { openSource } from '@app/actions'
import { useL } from '@app/i18n'
import { useStore } from '@app/store'
import { Modal } from './common'

export function useOpenFolder() {
  const input = useRef<HTMLInputElement>(null)
  const notify = useStore((s) => s.notify)
  const open = async () => {
    if (hasDirectoryPicker()) {
      try {
        const src = await pickDirectory((p, n) => useStore.getState().set({ busy: `${n} files … ${p}` }))
        if (src) await openSource(src)
      } catch (e) {
        notify(String((e as Error).message), 'error')
        input.current?.click()
      } finally {
        useStore.getState().set({ busy: null })
      }
    } else input.current?.click()
  }
  const element = (
    <input
      ref={input}
      type="file"
      style={{ display: 'none' }}
      // @ts-expect-error non-standard attribute
      webkitdirectory=""
      directory=""
      multiple
      onChange={(e) => {
        const files = e.target.files
        if (files?.length) openSource(FileListSource.fromFileList(files))
        e.target.value = ''
      }}
    />
  )
  return { open, element }
}

export const HF_EXAMPLES = ['lerobot/pusht', 'lerobot/aloha_sim_insertion_human', 'lerobot/svla_so101_pickplace', 'lerobot/droid_100']

export function RemoteDialog({ onClose }: { onClose: () => void }) {
  const L = useL()
  const [mode, setMode] = useState<'hf' | 'http'>('hf')
  const [repo, setRepo] = useState('lerobot/pusht')
  const [rev, setRev] = useState('main')
  const [token, setToken] = useState('')
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const go = async () => {
    setErr('')
    setLoading(true)
    try {
      const src = mode === 'hf' ? await HfHubSource.open(repo, rev || 'main', token || undefined) : new HttpSource(url)
      onClose()
      await openSource(src)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal title={L('Open remote dataset', '打开远程数据集')} onClose={onClose}>
      <div className="col">
        <div className="row">
          <button className={mode === 'hf' ? 'primary small' : 'small'} onClick={() => setMode('hf')}>
            Hugging Face Hub
          </button>
          <button className={mode === 'http' ? 'primary small' : 'small'} onClick={() => setMode('http')}>
            HTTP(S) URL
          </button>
        </div>
        {mode === 'hf' ? (
          <>
            <label className="col">
              <span className="muted small">{L('Repository id', '仓库 ID')}</span>
              <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="lerobot/pusht" />
            </label>
            <div className="row wrap">
              {HF_EXAMPLES.map((r) => (
                <span key={r} className="chip" onClick={() => setRepo(r)}>
                  {r}
                </span>
              ))}
            </div>
            <div className="row">
              <label className="col grow">
                <span className="muted small">{L('Revision / branch', '版本 / 分支')}</span>
                <input value={rev} onChange={(e) => setRev(e.target.value)} />
              </label>
              <label className="col grow">
                <span className="muted small">{L('Token (private repos, optional)', 'Token（私有仓库，可选）')}</span>
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="hf_…" />
              </label>
            </div>
            <p className="muted small">
              {L(
                'Only metadata and the byte ranges you look at are downloaded (HTTP range requests). Nothing is uploaded.',
                '只下载元数据和当前查看的数据片段（HTTP Range 请求），不会上传任何数据。',
              )}
            </p>
          </>
        ) : (
          <>
            <label className="col">
              <span className="muted small">{L('Base URL of a dataset folder (must allow CORS + Range)', '数据集根目录 URL（需支持 CORS 与 Range）')}</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/datasets/my_dataset" />
            </label>
          </>
        )}
        {err && <div className="badge err">{err}</div>}
        <div className="row">
          <span className="spacer" />
          <button onClick={onClose}>{L('Cancel', '取消')}</button>
          <button className="primary" onClick={go} disabled={loading}>
            {loading ? L('Loading …', '加载中 …') : L('Open', '打开')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
