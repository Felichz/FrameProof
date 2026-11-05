# Verdicts

| Status | It means | What you may say |
|---|---|---|
| `better` | Confirmed on fresh repetitions | "Improved by X late frames a step, interval Y" |
| `worse` | Confirmed on fresh repetitions | "Regressed by X" |
| `same` | The interval sits inside the margin | "No change larger than ±margin" |
| `inconclusive` | The data can't tell | "Not known". Never "no difference" |
| `invalid` | The steps didn't do what they claim | Nothing yet. Read why: it may be a real bug |
| `not-measurable` | This machine can't measure now | "Unmeasured", and why |

The other statuses: `ok` (the command did its job), `partial` (the browser was lost twice; the result
covers what was measured before, and says so), `running` (a `wait` ran out of time before the run did),
`failed` (a budget broke), `error` (a usage mistake, or a run that stopped before it finished; `next` says
what to type).

## Reading a cell

A comparison has one cell per step and throttle, such as `scroll/up@4x`. Each cell reports:

- `effect.lateFrames`: the shift of late frames a step (head minus base; negative is better), with its
  `interval`.
- `typical`: the median late frames of each build.
- `episodes`: rare stalls (a repetition with a freeze over `episodeMs`, 100 ms by default), as counts with
  Fisher's exact test. A median can't show a stall in 3 of 40 repetitions; this does. `0/30` comes with an
  upper bound ("under 10% at 95%").
- `reason`: why this verdict and not another, in words.

`inconclusive` comes with a `next` that says how many more repetitions it would take.

## What a verdict is not

It's evidence, not a decision. A change that is `better` may still trade something the person cares
about (see `perf/GOALS.md`); a `worse` may be worth it. Say what was measured and let the person decide.
Counts of work (`ledger`) say where work went, not whether frames improved: only `compare` judges a change.
