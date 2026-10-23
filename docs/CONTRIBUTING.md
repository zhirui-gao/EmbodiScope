# Contributing / extending EmbodiScope

```bash
npm install
EMBODISCOPE_DATA="/data/a:/data/b" npm run dev     # Windows: set EMBODISCOPE_DATA=D:\a;D:\b
npm test            # unit tests always run; integration tests run on datasets listed in tests/.local-datasets.json or $EMBODISCOPE_DATASETS
npm run typecheck
```

Integration tests print a semantic dump per dataset — run them after changing inference rules and diff the output.

## Add a dataset profile (documented conventions)

When names and values are not enough (e.g. a dataset documents its quaternion order or gripper polarity in a paper), add a profile in `src/core/semantics/profiles.ts`:

```ts
{
  id: 'my-lab-v1',
  label: 'My Lab robot dataset',
  reference: 'https://…',            // where the convention is documented
  match: (ds) => ds.robotType === 'my_robot',
  apply(segments) {
    for (const s of segments)
      if (s.feature === 'observation.state.tcp_pose') {
        s.pose = { pos: [0, 1, 2], rot: { repr: 'quat_wxyz', idx: [3, 4, 5, 6] }, child: 'tcp', parent: 'base_link' }
        s.overridden = 'profile'
        s.evidence.push('documented in the dataset card')
      }
    return segments
  },
}
```

Profiles run after heuristic inference and before action pairing.

## Improve general inference

* Key-level rules: `classifyFeature` in `src/core/semantics/infer.ts`.
* Per-dimension name parsing: `labelDims` / `poseComponent` (`tokens.ts`). Add vocabulary to the word lists there.
* Value-based fallbacks: `refineWithStats`.
* Add a regression case to `tests/semantics.test.ts` (pure name / token tests do not need data).

## Add a quality check

Append to `CHECKS` in `src/core/analysis/qa.ts`:

```ts
{
  id: 'signal.my_check',
  category: 'signal',
  needs: 'scan',                 // 'static' (metadata only) | 'scan' (EpisodeMetrics) | 'video' (MP4 probes)
  run: ({ ds, sem, metrics }) => [/* Issue with bilingual title/detail/hint and affected episodes */],
}
```

If the check needs a new per-episode quantity, add it to `EpisodeMetrics` and compute it in `computeEpisodeMetrics` (keep it JSON-serialisable — it crosses the worker boundary).

## Add an LLM provider

OpenAI-compatible endpoints only need a preset in `PRESETS` (`src/core/ai/llm.ts`). Other wire formats get a branch in `chat()`. Prompts live in `src/core/ai/prompts.ts`; model replies are parsed with `parseJsonLoose` and normalised (e.g. `normalizeSegments`).

## Add a data source

Implement `FileSource` (`src/core/io/source.ts`). Only `listing()` may return `null`; loaders fall back to path templates.

## Add a view

Create `src/ui/views/MyView.tsx`, add the tab id to `Tab` in `src/app/store.ts` and to the tab list in `src/app/App.tsx`. Use `useL()` for bilingual strings and subscribe to `playback` instead of storing the frame in React state.

## Code style

TypeScript strict, no default exports, small pure functions in `core`, comments only for constraints that the code cannot show.
