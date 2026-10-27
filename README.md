# EmbodiScope

**Understand your robot-learning data before you train on it.**
EmbodiScope is a browser-based inspection, quality-control, comparison and annotation platform for embodied-AI datasets in the [LeRobot](https://github.com/huggingface/lerobot) format (v2.0 / v2.1 / v3.0). Everything runs locally in your browser — datasets never leave your machine.

**▶ Use it online: <https://zhirui-gao.github.io/EmbodiScope/>** — open the page, pick a local folder (or a Hugging Face repo); nothing is uploaded.
Offline: download `embodiscope.html` from the [latest release](https://github.com/zhirui-gao/EmbodiScope/releases/latest) and double-click it.

[中文说明 →](README.zh-CN.md)

## Why

Mixing datasets is the norm in robot learning (OXE, AgiBot World, DROID, RoboMIND, EgoDex, InternData, RoboCoIN …), but every dataset encodes the world differently: quaternion `xyzw` vs `wxyz`, RPY vs rotation vectors, poses relative to `robot`, `armbase`, `odom` or `world`, grippers where `1` means *open* in one dataset and *closed* in another, actions that are absolute targets, deltas, normalised velocities — or literally a copy of the current state. These mismatches silently break training. EmbodiScope makes them visible.

## Features

| | |
|---|---|
| **Automatic format parsing** | Discovers every `meta/info.json` in a folder tree. LeRobot v2.0 / v2.1 (per-episode files) and v3.0 (concatenated files, episode offsets in parquet metadata). Sidecar annotations (`annotations/*.jsonl`), `info.yaml`, README, per-episode extras (AgiBot `action_config`, EgoDex `joint_confidence`, RoboMIND `action_semantics` …). |
| **Semantic inference** | Splits every vector into joints / EEF poses / grippers / dexterous hands / head / torso / base / cameras; infers rotation representation, quaternion order, units (m/mm, rad/deg/normalised), gripper polarity, reference frames from `<child>_to_<parent>_pose` names, action ↔ state pairing, absolute vs delta, embodiment. Value-based fallbacks for unnamed vectors and dataset *profiles* for documented conventions (RT-1, DROID, PushT …). Editable, persisted, exportable as `embodispec.json`. |
| **Synchronised episode viewer** | Multi-camera video + 3D scene: EEF trajectories with RGB (=XYZ) oriented axes, ghost axes along the path, action targets, camera frustums from intrinsics/extrinsics, human hand/body skeletons. **Projection overlay** draws EEF axes / hand skeletons into the video using the calibration — the fastest way to verify that frames and quaternion order are right. Subtask / label / gripper timeline, uPlot signal charts (state solid, paired action dashed), frame inspector, keyboard shortcuts. |
| **Quality checks** | Parallel Web-Worker scan of all episodes: timestamp monotonicity, dropped frames, jitter, frame-index continuity, NaN/Inf, idle head/tail segments, static episodes, action spikes, quaternion norm & sign flips, Euler wrap-around, **action–state temporal lag** (e.g. ALOHA ≈ 2 frames, SO-101 ≈ 4, AgiBot/RoboCoIN *action == state*), MP4 header probing (codec, frames, fps, length vs data), browser-decodability. |
| **Dataset comparison** | Side-by-side table with differing cells highlighted, automatic *harmonisation checklist* for co-training, overlaid duration histograms and EEF workspace. Export Markdown / CSV / JSON. |
| **AI lab (bring your own key)** | OpenAI-compatible APIs (OpenAI, Qwen/DashScope, DeepSeek, GLM, Kimi, SiliconFlow, OpenRouter, Ollama, vLLM), Anthropic, Gemini. **Format analysis** of the schema by an LLM with one-click application to the semantics. **Subtask decomposition & captions** with multimodal models (uniformly sampled frames + proprioceptive gripper/motion cues), batch annotation, export as JSONL or LeRobot-v2.1 `episodes.jsonl` with `action_config`. A training-free heuristic segmentation is always available. |
| **Sources** | Local folder (File System Access API or `<input webkitdirectory>`), drag & drop, Hugging Face Hub repos (range requests — only what you look at is downloaded), plain HTTP, and a zero-dependency Node server (`scripts/serve.mjs`) for datasets on remote machines. |
| **Analysis report** | One-click Markdown report per dataset (summary, semantics, issues, scan statistics). |

## Quick start

**Option A — single HTML file (no install).** Copy `embodiscope.html` from the repository root to any computer and double-click it (regenerate it with `npm run release`). Open a folder or drop it onto the page. Chrome / Edge recommended (folder access, AV1 decoding).

**Option B — hosted.** Use the GitHub Pages build of this repository; data still stays local.

**Option C — data on a server / big folders.**

```bash
node scripts/serve.mjs /path/to/datasets [/more/roots ...] --port 8686   # Node >= 18, no npm install needed
# open http://localhost:8686  (or tunnel the port from a GPU box: ssh -L 8686:localhost:8686 gpu-box)
```

Windows: `serve.bat D:\datasets`. Linux/macOS: `./serve.sh /data`. A fresh clone needs no `npm install` or build — the server falls back to `embodiscope.html`. `--host 0.0.0.0` shares it in the LAN (and exposes the data folder to it).

**Option D — development.**

```bash
npm install
EMBODISCOPE_DATA=/path/to/datasets npm run dev     # dev server also exposes local folders
npm test                                           # unit + integration tests (see tests/README)
npm run build && npm run build:single              # dist/ (Pages) and dist-single/index.html
```

URL parameters: `?hf=lerobot/pusht` opens a Hub dataset, `?server=http://host:8686` connects to a remote `serve.mjs`.

## Tested datasets (23)

- **v2.0**: physical-intelligence/libero (images in parquet), GR00T GR1 (RoboCasa-GR1, `modality.json`), GR00T-X-Embodiment-Sim gr1_arms_only.
- **v2.1**: AgiBot World, EgoDex (human hands), InternData-A1 (Franka / ARX Lift-2), Open X-Embodiment RT-1, RoboCoIN (dexterous hands), RoboMIND (16-bit depth), IPEC LIBERO-10, RoboTwin 2.0 EEF.
- **v3.0**: ALOHA sim, DROID-100, PushT, SO-101 (+ URDF), lerobot/libero, lerobot/robotwin_unified, lerobot/robocasa_target_human_unified, OpenMOSS RoboCasa365.

The in-app **Guide** (zh / en) is rendered from [docs/guide](docs/guide). Known gaps and plans: [docs/ROADMAP.md](docs/ROADMAP.md).

## Project layout

```
src/core/      framework-free TypeScript (runs in browser, Web Workers and Node)
  io/          FileSource abstraction: local handles, file lists, HTTP, HF Hub, Node fs
  data/        parquet reading (hyparquet), columnar FrameTable
  lerobot/     v2.x / v3.0 loaders, path templates, episode loading
  semantics/   feature → role/pose/frame inference, dataset profiles
  analysis/    episode metrics, QA checks, dataset cards, heuristic segmentation
  ai/          provider-agnostic LLM client, prompts, robust JSON parsing
  video/       MP4 box parser
src/app/       state (zustand), playback clock, scan orchestration, persistence
src/ui/        React views: overview, episode viewer, schema, quality, compare, AI lab
scripts/       serve.mjs data server, probe.mjs
tests/         vitest (pure unit tests + integration tests on local datasets)
docs/          architecture, contributing, data-convention notes
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) (how to add a dataset profile, QA check, LLM provider or view) and [docs/DATA_CONVENTIONS.md](docs/DATA_CONVENTIONS.md) (what researchers should check in embodied data and why).

## License

Apache-2.0
