# Review: frameproof on the portfolio, on a Mac

2026-11-04 and 2026-11-05. An agent used frameproof to find and fix freezes in the portfolio
(`portfolio-felix`), on a 2020 Intel MacBook (i5-1038NG7, Iris Plus, 60 Hz), Chrome 156. It ran from
`npx -y github:Felichz/FrameProof` and later from a local clone. This page is what worked, what didn't,
and what to change, with the runs behind each point. Numbers are late frames a step unless said
otherwise; runs are in the portfolio's `.frameproof/runs/` and its `perf/JOURNAL.md`.

## In short

The verdicts are the tool's strongest part: four changes that looked like wins came back
`inconclusive`, and none of them was shipped. `price` found the largest cost on the page in one run.
The weakest part is `freezes`: its heavy tracing turned a cost visitors never feel into a freeze in 3 of
3 repetitions, and sent the work after it. Second, the static server's address silently changed what
the portfolio does, so a day of numbers described a mode it doesn't ship in.

## What worked

- **`inconclusive` instead of a guess.** Four changes were judged and none moved a cell: cached tab
  boxes and glow colors in `deck.ts` (12 cells), a cached rail box in `Work.astro` (4 cells), one
  shared read-then-write frame for the pointer effects (6 cells, typical frames identical on both
  builds), and `@property` making `--panel-glow` non-inherited (priced). Each one had a dossier that
  made it look worth doing. A before/after pair would have reported at least two as wins.
- **`price` found the lever.** Hiding the recordings and stage frames on `carousel` at 4x:
  26.5 to 19 late frames, episodes 20/24 to 8/24 (p = 0.001). Hiding the cursor light: 29 to 25,
  episodes 20/24 to 14/24 (p = 0.11). One run each, no code touched, and the order of the work followed.
- **The journal.** Every compare landed in `perf/JOURNAL.md` with its note, so a dropped idea is written
  down with its numbers, and another agent on another machine (the Windows laptop) works from the same
  file.
- **`scenario check`.** Five scenarios ported from the portfolio's old scripts passed on the first check,
  and the check's late-frame counts already hinted where the trouble was.

## What to change, most important first

### 1. `freezes` reports freezes that light runs don't have

`freezes -s journey,scroll,carousel,projects --throttle 4 -n 3` put `scroll down` and `scroll up` at
83 to 217 ms, in 3 of 3 repetitions, on `deck.ts:120` (a frame callback reading the tabs' boxes and the
section's colors). The `compare` that followed ran the same scroll with light tracing, 16 repetitions a
build at 4x: **0 of 16 episodes on either build**. The deep tracing (stacks, invalidations, V8 samples)
slows the main thread enough to make small forced restyles cross the freeze line. The fix to `deck.ts`
was written, verified pixel for pixel, measured for 51 minutes, and dropped.

Proposed: `freezes` also runs each scenario a few times with light tracing and prints, per group,
`light runs: 0/8 episodes` next to `in: 3/3`. A group with no light episodes is labeled "seen under deep
tracing only" and sorts last. `next` should point at groups that light runs confirm.

### 2. The serving address changed what the page does, without a word

The static server listened on `127.0.0.1`. The portfolio loads its previews' stages from the *other*
local name (`localhost` when the page is on `127.0.0.1`, see its `src/scripts/origin.ts`), so the
stages ran in their own process. Production has no second origin: there the stages run in the page's
process. Same build, `carousel next` at 4x: about 27 late frames a step on `127.0.0.1`, about 49 on
`[::1]`, with episodes in 24 of 24. Every run before the switch measured the lighter mode.

Done locally (553db63): `serve: { static: true, host: '::1' }`. Proposed on top: the run header lists
the frames from other local origins it saw (`stages from http://localhost:PORT, out of process`), and
`next` asks about it once, since it changes every number.

### 3. A long run dies whole

- `calibrate -s load,idle,scroll,carousel,projects,window,theme --throttle 1,4` ran for about an hour,
  627 steps, then failed with `Connection closed.` (Chrome went away while the machine's load average
  reached 45, from processes outside the run). Nothing was kept: the machine is still not calibrated.
- `ledger -s idle,scroll,carousel,projects,window,theme -n 2` failed once with
  `Protocol error (Target.attachToTarget): No target with given id found`.

Proposed: a lost browser is relaunched and the block is repeated; finished strata are kept, and a
calibration resumes from the last finished cell. `busy` checks between blocks, not only at the start.

### 4. Judging is slow, and the default margin makes most results `inconclusive`

`compare -s scroll,carousel,theme --throttle 1,4` took 51.3 minutes; two scenarios at two speeds took
22 to 26. With the default margin of ±2 and no calibration, intervals like `[-13.18, 9.18]` on
`carousel/next@4x` can't be called anything. The advice to calibrate first costs more than an hour on
this machine, and failed (point 3).

Proposed: margins learned from the base build's own repetitions in each compare (they are an A/A of the
base against itself in time), so a first compare is calibrated enough to say `same`; and a
`--throttle` default read from `perf/GOALS.md`, which on this project now says 1x.

### 5. Names that pointed at the wrong code (done locally)

- An inline script was named by the page's line: `/:44` held four of Astro's inline scripts, and the
  last map comment in the page won. Now each inline script resolves through its own map, found beside
  the page or by name in the build (8a28c25).
- A click was named after the first function under it: a cheap listener that ran first named a 440 ms
  product change. Now the heaviest one names it (8a28c25).
- `Work.astro:36` was line 36 of one of the component's `<script>` blocks, not of the file. Now:
  `Work.astro script 1, line 36` (ec314a2).
- `clean()` cut `src/components/X.astro` to `components/X.astro` while `src/scripts/x.ts` kept its
  `src/` (8a28c25).

### 6. Setups leak work into steps

The first pointer move in a setup started the portfolio's automatic app boot, 600 ms later, which fell
inside the first step (`live:knowgraph:boot@124` in the step's marks). A visitor can meet that too,
which made it a real finding, but the tool didn't say the cost was started by the setup.

Proposed: a step's dossier says when a mark or a long task in it began from something its setup did
(a timer or a promise armed before `perf:act`), and a scenario option waits for the page to be idle
(no timers due, no frames asked for) before the first step.

### 7. Two notes on using it

- `npx github:Felichz/FrameProof` runs what is pushed: fixes made in a local clone help nobody else
  until then. A `frameproof version` in every envelope (commit, dirty or not) would make that visible.
- The built-in `scroll` doesn't fit a page that moves one section per key (the portfolio's deck); the
  project's own `scroll` replaced it. `scenario check` could say when a built-in step changed nothing
  on screen, which it does for steps already, and suggest the replacement.

## Results on the portfolio, so far

| Change | Cells | Verdict |
|---|---|---|
| `deck.ts`: tab boxes and glow colors cached | scroll, carousel, theme at 1x and 4x | inconclusive in 12; dropped |
| `Work.astro`: rail box cached | carousel at 1x and 4x | inconclusive in 4; dropped |
| Pointer effects read before writing, in one frame | carousel, projects at 1x and 4x | inconclusive in 5, `same` in 1; dropped |
| `--panel-glow` not inherited (price) | carousel at 4x | inconclusive; not made |
| Recordings and stage frames hidden (price) | carousel at 4x | better: -9, episodes 20/24 to 8/24 |
| Cursor light hidden (price) | carousel at 4x | better: -4, episodes not significant |
| Automatic boot waits while the hand is on the rail | carousel, projects at 1x and 4x, on `[::1]` | running |

The two levers left are the stages' process (a second origin in production, which the portfolio already
supports as `PUBLIC_STAGE_ORIGIN`) and when an app boots relative to a product change. Both need
`[::1]` and `127.0.0.1` measured side by side, at normal speed first, as the project's goals now say.
