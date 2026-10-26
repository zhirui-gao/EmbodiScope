# EmbodiScope user guide

EmbodiScope inspects, explains, cleans and compares embodied-AI datasets (LeRobot v2.0 / v2.1 / v3.0 and GR00T-flavoured LeRobot) before you train on them. Everything runs locally in your browser — nothing is uploaded.

> The "中文 / EN" switch at the top right changes the language of the whole interface, including this guide.

## 1. Quick start

1. **Open data** — click "Open folder" or drop a folder onto the page. A single dataset or a parent folder with many datasets both work; every `meta/info.json` is discovered.
2. **Overview** — pick a dataset on the left: size, fps, cameras, state / action composition, conventions and annotation granularity.
3. **Episode viewer** — click an episode in the left list, press Space to play.
4. **Quality scan** — "Run full scan" on the Quality tab; thousands of episodes typically take seconds to tens of seconds.
5. **Clean & export** — flag problematic episodes as *exclude / review* and export episode lists from the sidebar for your training filter.

### Browsers

Chrome or Edge (folder access API + AV1 decoding). Firefox / Safari work through the folder upload dialog, but AV1 videos may not play.

### Running on another computer

| Situation | How | Needs |
|---|---|---|
| Data on that computer | Copy the single file `embodiscope.html`, double-click it in Chrome / Edge, then "Open folder" | nothing |
| Data on a server / shared drive, or very large | Copy the repository (at least `scripts/` and `embodiscope.html`), run `node scripts/serve.mjs <data folder>` on the machine that has the data (`serve.bat <folder>` on Windows) and open the printed address | Node.js ≥ 18 (no `npm install`) |
| Remote GPU server | On the server `node scripts/serve.mjs /data --port 8686`, locally `ssh -L 8686:localhost:8686 user@server`, open http://localhost:8686 | Node.js on the server |
| Shared in a LAN | `node scripts/serve.mjs /data --host 0.0.0.0 --port 8686`, colleagues open `http://<this-ip>:8686` | Node.js; exposes the data folder to the network |
| Hosted | push to GitHub and enable Pages; any computer opens the URL, data is still read locally | nothing |
| Development | `npm install`, `npm run dev`; `npm run release` regenerates `embodiscope.html` | Node.js + npm |

## 2. Data sources

| Source | When | Notes |
|---|---|---|
| Local folder | data on your computer | files are read lazily, only the needed byte ranges of large files |
| Drag & drop | quick look | folders can be dropped |
| Hugging Face Hub | public / private repos | repo id, token for private repos; only what you look at is downloaded |
| HTTP URL | static servers | server must allow CORS and Range requests |
| `serve.mjs` data server | data on a remote GPU box | `node scripts/serve.mjs /data --port 8686`, open the address and the data is connected automatically |

URL parameters: `?hf=lerobot/pusht` opens a Hub dataset, `?server=http://host:8686` connects to a remote data server.

## 3. Tabs

### 3.1 Overview

- **Size**: episodes, frames, total duration, duration distribution.
- **Embodiment & action space**: single / dual arm, humanoid, mobile, dexterous hand, human hands; state and action composition (e.g. `L·joint(7) + L·gripper(1)`); action space and type (absolute / delta / velocity).
- **Conventions**: rotation representation, quaternion order, reference frames, length / angle units, gripper polarity, camera model. *declared* = from the `convention` block of `info.json`, *inferred* = by EmbodiScope.
- **Annotation granularity**: task → per-episode instruction → subtask segments → skills / frame-level primitives → scene descriptions, scored 0–5.
- **Cameras, reference-frame tree, feature table, sidecar metadata** (README, info.yaml, label vocabularies).
- Export a Markdown report at the top right.

### 3.2 Episode viewer

- **Videos** play in sync; v3.0 concatenated videos are offset per episode automatically.
- **Projection overlay** (⊕): when a camera has intrinsics and extrinsics in the same frame as the EEF poses, EEF axes / hand skeletons are projected into the video. **If the projection sits on the gripper / hand, the frame, quaternion order and extrinsic direction are right.**
- **3D view**: red = X, green = Y, blue = Z. The large triad is the reference frame, small triads are end effectors, translucent "ghost" triads show orientation along the path, yellow pyramids are camera frustums. Top-right controls: reference frame, up axis (Z-up / Y-up), trail, ghosts, action targets, cameras.
- **Action-chunk preview**: set a horizon H and the 3D view draws the next H action targets from the current frame — the supervision signal of ACT / Diffusion Policy / π0-style models.
- **URDF robot model**: for joint-only datasets (ALOHA, SO-101, RoboTwin joint version …) load a URDF; links and the end-effector frame are drawn with forward kinematics, joints are matched by name.
- **Timeline**: metadata subtasks (e.g. AgiBot `action_config`), frame-level labels (RoboCoIN subtasks / motion directions, decoded through vocabularies), gripper open / closed, AI / manual annotations, heuristic segments. Click or drag to seek, double-click a segment to jump to its start.
- **Annotation editor** (below the timeline): create or edit subtask segments — set to current frame, split, delete, rename. Export from the AI lab.
- **Signal charts**: solid = observation, dashed = paired action. Click to seek; chips toggle chart groups. Charts render only when scrolled into view.
- **Frame values**: every signal at the current frame; rotations are also shown as xyzw quaternions.

### 3.3 Schema & frames

Every feature is split into signal segments with role, side, rotation representation, reference frame, units, gripper polarity and action type, plus the evidence and confidence of the inference.

- **Edit any cell** — corrections are stored per schema signature and reapplied to datasets with the same schema.
- ⚠ marks ambiguous rotations (e.g. bare `rot_x/y/z`); switch and verify immediately in 3D / the projection overlay.
- **Per-dimension statistics** on a shared axis: min–max and mean ± std; red = constant dimension (z-score would divide by zero), yellow = tiny range.
- **EmbodiSpec export**: the full interpretation as JSON, to drive training-side converters.
- **AI format analysis**: an LLM explains every signal; apply its suggestions with one click.

### 3.4 Quality

| Check | Meaning | Why it matters |
|---|---|---|
| non-monotonic timestamps / gaps / jitter | broken time steps | video ↔ action misalignment, wrong velocities |
| frame_index gaps, length ≠ metadata | structure | index misalignment |
| NaN / Inf | invalid numbers | training crashes |
| idle head / tail, static episodes | frames without motion | policies learn to wait |
| action spikes | huge single-step changes | teleop glitches, IK flips, restarts |
| non-unit quaternions / sign flips | q and −q mixed | discontinuous regression targets |
| Euler wrap-around | ±π jumps | breaks normalisation / regression |
| action == state | action[t] equals state[t] | no future information unless shifted |
| action leads state by k frames | controller latency | action-chunk alignment |
| motion bandwidth | frequency holding 90 % of motion energy | subsampling, control rate |
| codec / frames / fps | video problems | undecodable or misaligned videos |

- Episode chips under an issue jump to that episode; the per-episode table sorts and opens episodes.
- **Scan results are cached in the browser** and restored next time; use "Re-scan" when the data changed.
- Workspace plots show sampled EEF positions of all episodes (XY / XZ / YZ).

### 3.5 Compare

- All dataset-card fields side by side; **differing cells are highlighted**.
- An automatic *harmonisation checklist* for co-training: fps, quaternion order, rotation format, action space, gripper polarity, units, frames, cameras.
- Overlaid duration histograms and EEF workspaces; export Markdown / CSV / JSON.

### 3.6 AI lab

1. **Provider** — pick a preset (OpenAI, Qwen, DeepSeek, GLM, Kimi, SiliconFlow, OpenRouter, Anthropic, Gemini, Ollama, vLLM), enter the key, "Test". Keys live in session storage unless "remember" is checked.
2. **Format analysis** — sends only schema information (names, shapes, value ranges, first frame, metadata), no images or raw episodes.
3. **Subtask decomposition & captions** — choose camera, number of frames, granularity and scope. Frames are sampled uniformly, proprioceptive cues (gripper events, motion pauses) are added, requests run in parallel. Results appear on the timeline and can be edited.
4. **Export** — `subtasks.jsonl` or a LeRobot-v2.1 `episodes.jsonl` with `action_config` (AgiBot style, can be written back into the dataset).

> CORS errors mean the provider blocks browser calls — use a local proxy, Ollama or vLLM. Without a key, `npm run mock-llm` starts a mock server to try the workflow.

## 4. Flagging & curation

- At the top of the episode viewer mark the episode **keep ✓ / exclude ✗ / review ?** and add a note. Shortcuts: `G` keep, `B` exclude, `R` review.
- Filter the sidebar episode list by flag, or show only episodes with quality-scan issues.
- "Export lists" in the sidebar writes `episodes_keep.json` / `episodes_exclude.json` (episode indices) and `episode_flags.json` (flags, notes, issues).
- Issue cards on the Quality tab can flag all affected episodes for review.

## 5. Deep links

The address bar tracks dataset, tab, episode and frame (e.g. `#ds=…&tab=episode&ep=12&f=340`). Reloading returns to the same place; with the data server or the Hub the link can be shared with colleagues.

## 6. Keyboard

| Key | Action |
|---|---|
| Space | play / pause |
| ← / → | previous / next frame |
| Shift + ← / → | ±10 frames |
| Home / End | first / last frame |
| [ / ] | previous / next episode |
| G / B / R | flag keep / exclude / review |

## 7. Troubleshooting

- **Black video / "cannot decode"** — the browser lacks the codec (MPEG-4 Part 2 / FMP4, HEVC on some systems). Re-encode to AV1 or H.264; data and 3D are unaffected.
- **Double-clicked HTML cannot read folders** — use Chrome / Edge; if `file://` folder access is blocked use `serve.bat` / `serve.sh` or the hosted build.
- **"No poses in this frame"** in 3D — switch the reference frame, set the signal role to EEF pose in the Schema tab, or load a URDF for joint-only data.
- **Projection not on the gripper** — check quaternion order (xyzw / wxyz), extrinsic direction (camera→robot vs robot→camera) and optical convention (OpenCV / OpenGL); all are editable in the Schema tab.
- **Large datasets** — Hub and data-server sources only read what is needed; scans can be run on a subset.
- **CORS (HTTP / Hub)** — the server must send `Access-Control-Allow-Origin` and support Range requests; `serve.mjs` does.

## 8. Supported formats

- LeRobot v2.0 / v2.1 (per-episode files) and v3.0 (concatenated files).
- GR00T-flavoured LeRobot: `meta/modality.json` groups split state / action.
- Images and 16-bit depth PNGs embedded in parquet (RoboMIND, physical-intelligence/libero).
- Sidecar annotations: `annotations/*.jsonl` vocabularies, episode-level `action_config` / `subtasks`, `info.yaml`, README.
- Not yet (planned): raw HDF5 (robomimic / LIBERO / RoboTwin raw), RLDS / TFDS, Zarr.

## 9. Extending

See `docs/ARCHITECTURE.md` and `docs/CONTRIBUTING.md` in the repository: adding dataset profiles, quality checks, LLM providers, data sources and views.
