# Architecture

EmbodiScope is a static single-page app. There is no backend: every byte is read in the browser through a `FileSource`, parsed with [hyparquet](https://github.com/hyparam/hyparquet), and analysed in TypeScript. The optional `scripts/serve.mjs` only serves files.

```
            ┌──────────── FileSource ────────────┐
 local dir  │ FsHandleSource  FileListSource      │   listing(), readText(), asyncBuffer(), url()
 HF Hub     │ HfHubSource     HttpSource          │   (random access → parquet footers / row groups,
 serve.mjs  │ ServerSource    NodeFsSource (tests)│    video byte ranges)
            └───────────────┬────────────────────┘
                            ▼
   lerobot/loader  discoverDatasets() → loadDataset()  (v2.x: jsonl metadata, v3.0: parquet metadata)
                            ▼
   LeRobotDataset { info, features, episodes[{dataPath,rowStart,rowEnd,videos{path,fromTimestamp}}], tasks, stats, extras }
                            ▼
   semantics/infer  inferSemantics() → DatasetSemantics { segments[], cameras[], frames[], embodiment … }
        ├─ classifyFeature   key-level rules (pose keys, intrinsics, labels, deltas …)
        ├─ labelDims/group   per-dim name parsing → split concatenated vectors
        ├─ refineWithStats   value-range fallbacks (unnamed xyz+euler+gripper …)
        ├─ applyProfiles     documented dataset conventions (profiles.ts)
        └─ pairActions       action ↔ state segment pairing, absolute / delta
                            ▼
   analysis/*      datasetCard(), runChecks(), computeEpisodeMetrics(), heuristicSegments()
                            ▼
   app/ (zustand store, Playback clock, scan worker pool)  →  ui/ (React views, three.js, uPlot)
```

## Key design decisions

* **`src/core` has no DOM / React imports.** It runs in the main thread, in Web Workers (`workers/scan.worker.ts`) and in Node (vitest integration tests, CLI). Keep it that way — UI concerns go to `src/app` and `src/ui`.
* **Segments, not features.** A `Segment` is a contiguous slice of one feature with one meaning (e.g. `observation.state[12:24]` = left dexterous hand). Everything downstream (charts, 3D, QA, cards, exports) works on segments, so a dataset that concatenates everything into `observation.state` and one that stores 60 separate pose columns are handled identically.
* **Columnar `FrameTable`.** Episodes are decoded into `Float64Array`s (`value(t, d) = data[t*dim + d]`). Binary columns (embedded PNG depth, images) are deferred and loaded on demand.
* **Frame index is the clock.** `Playback` owns the current frame; videos are slaved to it (`offset + (frame + 0.5) / fps`, which also handles v3 concatenated videos) and the first healthy video drives the clock while playing. Charts, 3D scene and overlays subscribe imperatively — React never re-renders at 60 fps.
* **Bilingual by construction.** UI strings use `L(en, zh)` inline; QA issues carry `{en, zh}` objects. No translation keys to keep in sync.
* **Persisted corrections.** User/LLM edits to semantics are stored in `localStorage` under a *schema signature* (hash of feature keys, dtypes and shapes + robot type), so every dataset with the same schema reuses them. `toSpec()` exports the full interpretation as `embodispec.json`, intended to drive training-side converters.
* **Two builds.** `vite build` → `dist/` (GitHub Pages / any static host). `vite build --mode single` → one self-contained HTML (workers inlined as blobs) that works from `file://`.

## Data flow of a quality scan

1. `app/scan.ts` resolves each available episode to something transferable (`File` for local sources, URL for HTTP) and computes the needed columns from the semantics (`scanColumns`).
2. A pool of `min(6, cores-1)` workers receives the config once and episode jobs one by one; on worker failure the job runs on the main thread.
3. Each worker reads only those columns for the episode's row range, builds a `FrameTable` and returns `EpisodeMetrics` (plain JSON).
4. MP4 headers of sampled episodes are probed (`video/mp4.ts`, reads only the `moov` box).
5. `runChecks()` turns metadata + metrics + probes into bilingual `Issue`s.

## Performance notes

* Parquet is read with byte-range access; the footer is cached per buffer. For HF / HTTP sources only accessed row groups are downloaded.
* EgoDex episodes (≈500 numeric dims, up to 10 MB) decode in tens of milliseconds; a 50-episode ALOHA scan takes < 1 s in the browser.
* 3D trails are static `BufferGeometry`; per-frame updates only move a few objects. The renderer only renders when the frame or the camera changes.
