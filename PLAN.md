# Plan

How to turn the performance scripts of one project into a tool any web project can use, with a coding agent as its main user.

## Starting point

`scripts/perf/` in the portfolio is 23 scripts and about 4,100 lines of code, grown over 54 commits. Most of it is history. Five files hold what was actually used at the end, about 1,500 lines:

| File | Lines | What it does | Goes into |
|---|---|---|---|
| `kit.mjs` | 258 | Serve a build, launch Chrome off screen, source map lookup, cycles | `core/` (minus the portfolio's own cycles) |
| `drops.mjs` | 299 | Late frames from `PipelineReporter`, by stage, A/B with p-values | `core/frames`, `core/stats` |
| `freezes.mjs` | 463 | Per-freeze dossiers, verdicts, grouping by cause | `core/freezes` |
| `ledger.mjs` | 416 | Counted work per scene, who forces and who asks | `core/ledger` |
| `invariants.mjs` | 68 | Budgets over the ledger | user config |

What is portable: reading the trace, the statistics, the dossiers, the ledger. What is not: the scenes, which know about the portfolio's deck, stages and recordings. That split is the main extraction job.

## What the original got wrong

These all happened on one day of real use (2026-11-04, integrating one feature). Each one is a requirement.

1. **A false alarm.** A batch of comparisons reported `scroll up` at 4x as worse, p = 0.020. A repeat gave p = 0.42. With six comparisons at the 0.05 level, the chance of at least one false positive is 26%, and the tool printed "(real)". *Requires: correction across steps, and a confirmation run before a `worse` or `better`.*
2. **Absence of evidence read as evidence.** The tool prints "not distinguishable from noise" and the agent wrote "no difference", from 8 repetitions with samples like `[0 1 1 1 1 1 50 0]`. That run could not have seen a modest regression. *Requires: `same` only when the interval sits inside a margin; otherwise `inconclusive`.*
3. **The mean carried the outliers.** The test is a permutation on the difference of means, so one 50-frame stall decides the result, and the median doesn't show it at all. *Requires: typical frames and rare episodes as two separate measures.*
4. **Rare stalls needed arithmetic by hand.** Stalls of 100 to 660 ms appeared in 6 of 40 repetitions on one build and 3 of 40 on the other. The agent had to sum runs by hand to conclude anything (Fisher's exact test: p = 0.48). *Requires: episode rates compared directly, with their test, accumulated over runs.*
5. **The worst cost was outside every cycle.** The 3D phone blocked the main thread for 530 to 750 ms as the visitor arrived, and no A/B cycle covered that moment. It was seen by luck: a one-frame rule failed, and the same report happened to list the hottest function. *Requires: a watch over the whole journey, and a warning about moments no scenario covers.*
6. **Moving work looked like removing it.** The ledger counts the page's main thread. After the work moved to a worker its numbers fell to almost nothing, and the ledger cannot tell a move from a removal. *Requires: every thread and the GPU process counted, reported as moved or removed.*
7. **Timeouts threw the run away.** Two runs died on `the deck did not come back` and `the showcase stayed on the same product`, losing the repetitions already measured. Under load these are slow runs; in another case the same failure was a real bug (a focused field scrolling the page). *Requires: a failed step recorded, classified and retried, never a crash.*
8. **The agent wrote throwaway parsers.** It wrote a script to attribute a cost from the trace, which printed nothing because the profile's names were minified, then another to find a forced layout's stack. *Requires: a query interface over a run, with source-mapped names.*
9. **Choosing cycles was a judgment call.** The agent picked `product` and `scroll` and did not run `window` or `theme`. *Requires: knowing which scenarios exercise the changed files.*
10. **Building the variants was manual.** Copying folders, moving `dist-maps` aside, building `main` from another worktree into a path of this one. *Requires: `--base` and `--head` as git refs, builds cached by commit.*

And what the original got right, to keep:

- Late frames from the compositor, not `requestAnimationFrame` counts.
- Alternated builds in one session, and never a number from another day or machine.
- A real headed Chrome placed off screen, since headless has different compositing and timing. It never takes the user's focus.
- Warm profiles by default, with `--cold` for first-visit costs.
- CPU throttling as the stand-in for a modest machine.
- Injected costs to calibrate, and injected CSS to price a change before making it.
- Scenes that assert what they did.
- Tracing artifacts handled (V8's profiler start shows up as a 25 ms freeze, so each step waits and marks when it really starts).
- The "tried and dropped" list in `MEASURING.md`. It was the most useful page in the project.

## Principles

1. **The verdict is the product.** A number without its uncertainty isn't output.
2. **Details only on request.** Summary first, the rest by handle, so a run costs the agent few tokens.
3. **Everything is a file.** Runs are plain JSON on disk that an agent can read, diff and commit.
4. **Fail loud about the measurement.** An invalid run says why and what to do.
5. **Never in the user's way.** No visible windows, no killing processes, no focus stealing.
6. **The tool is its own manual.** An agent that knows nothing about it can get through by following its output.

## How it is consumed

The target experience is one sentence, to any agent, with nothing installed beforehand:

> Use github.com/Felichz/frameproof to find out why scrolling stutters here, and fix it.

Everything else follows from making that sentence work. The agent may be Claude Code, Codex, Cursor or something that doesn't exist yet, so nothing can depend on one harness.

**The path an agent takes:**

1. **It reads `AGENTS.md`** at the root of this repo: the cross-agent convention, with `CLAUDE.md` importing it. The page is short and carries only the entry command, the loop, how to read a verdict and the rules. It works from the GitHub page, so the agent doesn't have to clone anything.
2. **It runs `npx frameproof@latest next`** in the project. No install step, and nothing added to the project's dependencies unless someone wants it pinned for CI.
3. **`next` drives the rest.** It reads the state of the project and the machine and returns the single next action with its exact command:

| State | `next` says |
|---|---|
| No Chrome found | How to get one, or that it will download a pinned build |
| No config | Run `init` |
| `perf/GOALS.md` empty | Ask the person these questions, and write the answers there |
| Goals but no scenarios | Write one for this interaction, with a template and the built-in ones that apply |
| Scenario never run | `scenario check <file>` |
| Never calibrated on this machine | `calibrate` |
| Machine busy | Wait, naming what is using it |
| Ready, no findings | `freezes` on the goals' scenarios |
| Ready, uncommitted change | `compare` against the base branch |

This is the difference from documentation. A skill file goes stale and an agent can skim it; a state machine in the CLI can't be misread, always matches the installed version, and works the same in every harness. `AGENTS.md` only has to get the agent to the first command.

**Other pieces this needs:**

- **`guide [topic]`** prints the manual from the installed package: scenarios, verdicts, budgets, reading a freeze.
- **`init`** adds to the project and overwrites nothing: `frameproof.config.js` (framework detected), `perf/GOALS.md`, `perf/JOURNAL.md`, `perf/scenarios/`, and a marked block in the project's `AGENTS.md` so later sessions already know the tool is there. Where it detects a harness it adds that harness's form too, such as `.claude/skills/frameproof/SKILL.md`, which is the same content pointing at `next`.
- **`scenario check <file>`** runs a scenario once and reports each step: selector not found, `done` never true, nothing happened on screen. Writing a scenario is the one creative task left, so it needs a tight feedback loop. It's also where agents will fail most.
- **`report`** writes the result for a person, for a PR or a chat, in wording tied to the status: it can't turn `inconclusive` into "no difference".
- **`perf/GOALS.md`** holds what only a person knows: which interactions matter, what counts as a modest machine, what they won't trade away. It generalizes the "Deciding trade-offs" section of the portfolio's `CLAUDE.md`, which is what let an agent stop escalating every decision. It's the only place the tool sends the agent back to the person.

**Where it can't run.** `compare` needs a real display and GPU. A cloud agent in a container has neither, so there `doctor` returns `not-measurable` for frames and `next` falls back to what still holds: `ledger` and `check` on counted work, headless, labeled as such. "Any agent" means any agent on a real machine, and a clear answer everywhere else.

**How we know it works.** `examples/janky-shop`: a small app with planted problems of known cause (forced layout in a scroll handler, a shader link on arrival, a whole-page restyle, a `requestAnimationFrame` loop that never rests, and a red herring that measures as nothing). The test: a fresh session of each agent, an empty context, the one sentence above, no help. It scores how many planted causes it finds, whether its fixes pass `compare`, whether it claims anything the data doesn't support, and how many tokens it took. This is the tool's real benchmark, and it runs from phase 1 on, since what agents trip over should steer the design.

## Shape

A CLI, with JSON on stdout and a stable exit code, run through `npx`.

CLI over MCP first: every agent harness has a shell, a run lasts minutes and has to survive in the background, and the output is useful to people and CI as is. A thin MCP server can wrap the same core later if it earns its place.

```
frameproof next                       the one thing to do now, from the project's and machine's state
frameproof guide [topic]              the manual, from the installed version
frameproof doctor                     can this machine measure right now?
frameproof init                       detect the framework, add the config, goals, journal and scenarios folder
frameproof scenario check <file>      run a scenario once and say what each step really did
frameproof calibrate -s <scenario>    noise floor, smallest effect visible, repetitions needed
frameproof compare --base --head      alternated A/B, with verdict
frameproof price --inject <css|js>    what a change would be worth, before making it
frameproof freezes --ref -s --min     freezes grouped by cause
frameproof show <id>                  one freeze's dossier, or one section of it
frameproof query <run> <what>         hot functions, forced layouts, who asks for frames, by thread
frameproof ledger --ref               counted work per scenario
frameproof check                      budgets; exit 1 on a break, for CI
frameproof affected --base --head     the scenarios that run the changed files
frameproof journal                    the experiments so far
frameproof report [run]               the result written for a person
```

### Configuration

```js
// frameproof.config.js
export default {
  build: { command: 'npm run build', out: 'dist', env: { SOURCEMAP: '1' } },
  serve: 'static',            // or { command, url } for a server, or { url } for a deployed site
  scenarios: './perf/scenarios',
  budgets: './perf/budgets.js',
};
```

### Scenarios

The one thing a project has to write. `done` is required: it is how a step that did nothing is told apart from a step that was fast.

```js
export default scenario('open-modal', {
  setup: async ({ page, url }) => page.goto(url),
  steps: [
    {
      name: 'open',
      act: ({ page }) => page.click('[data-open]'),
      done: ({ page }) => page.waitForSelector('dialog[open]'),
    },
    {
      name: 'close',
      act: ({ page }) => page.keyboard.press('Escape'),
      done: ({ page }) => page.waitForSelector('dialog:not([open])'),
    },
  ],
});
```

Built in, with no code: `load`, `idle` (does the page do anything at rest?), `scroll`, and `journey`, which walks the listed scenarios in order from a fresh page and reports anything blocking the main thread at any moment, between steps included.

### Output contract

Every command returns the same envelope:

```json
{
  "status": "better | worse | same | inconclusive | invalid | not-measurable",
  "summary": "one sentence",
  "machine": "fingerprint",
  "run": "2026-11-04T19-22-a1b2",
  "evidence": [],
  "next": ["suggested commands"]
}
```

- Exit codes: `0` a verdict was reached, `1` a budget or regression failed, `2` not measurable, `3` usage.
- Default output stays under a fixed budget (target: about 400 tokens). `--full` lifts it.
- `next` is a suggestion a tool can compute (`inconclusive` proposes how many more repetitions), never a decision.
- Long runs: `--background` returns the run id, `frameproof wait <run>` blocks. Partial results are readable at any time.

## Statistics

The design, in the order things are decided. To be validated by simulation before trusting it (phase 2).

- **Unit:** one repetition of one step, in a fresh page. Builds alternate in blocks, each block in its own browser.
- **Typical cost:** late frames per step, compared with a permutation test stratified by block, on a robust statistic. Reported as a Hodges-Lehmann shift with a bootstrap interval.
- **Rare episodes:** a repetition counts as an episode when a freeze passes the threshold. Compared as rates with Fisher's exact test, with a stated upper bound when nothing was seen ("0 of 30: under 10% at 95%").
- **Multiple comparisons:** Holm across the steps and throttles of one comparison.
- **Two stages:** a result that looks significant triggers a confirmation run on fresh repetitions, and only that run's data decides. This is the direct fix for the false alarm above.
- **Margin:** `same` needs the interval inside a margin. The default comes from `calibrate`, and it can be set per scenario.
- **Stopping:** repetitions grow in batches until a verdict or a time budget, using a method valid under repeated looks, since checking p-values after each batch without one inflates false positives.

## Attribution

The dossier keeps its current content (stage, tasks split into script, style, layout, paint, GC, invalidations, V8 samples, GPU process) and gains:

- **All threads.** Main, workers, GPU process, other renderers, each with its time. A before and after reports work as `removed`, `moved to <thread>` or `added`.
- **Surfaces.** The verdict `waiting on another frame's surface` doesn't say which surface. Naming the frame, canvas or video behind it would have settled a suspicion that needed 40 repetitions to set aside, and still only as "can't tell".
- **Named shader and GPU costs.** Shader links are a frequent, hidden source of long blocks.
- **Source maps everywhere,** apps and workers included, so names in every output are real.

## Journal

`perf/JOURNAL.md`, in the user's repo, appended by `compare` and `price`: hypothesis, change, verdict, run id, date. An agent reads it before starting. Context gets compacted and sessions end; this is what stops the next one from retrying a dead end.

`--note "why"` adds the hypothesis. A human can edit it freely.

## Phases

Each phase ends with something that runs, and an acceptance test.

**Phase 0. Extract, unchanged.** Port the five files into `core/` behind a config, with the portfolio as first consumer.
*Done when:* `compare` on the portfolio reproduces the known results for KnowGraph's video (5544ad0) and the transform experiment.

**Phase 1. Agent contract.** Envelope, exit codes, run store, `next`, `guide`, `doctor`, `show`, `query`, `scenario check`, `report`, failed steps kept and retried, and `examples/janky-shop` with its test.
*Done when:* a fresh agent, given this repo and the sample app and nothing else, goes from one sentence to a named source line without reading a trace or writing a script.

**Phase 2. Honest statistics.** Everything in the Statistics section, and `calibrate`.
*Done when:* over simulated and real A/A runs, `worse` or `better` appears at or below the stated rate; with injected costs, sensitivity matches what `calibrate` promised; replaying the runs of 2026-11-04 no longer calls `scroll up` real.

**Phase 3. Any project.** `init` with its harness files, git refs with cached builds, server and remote targets, built-in scenarios, the fallback without a display.
*Done when:* it runs on two unrelated apps of different stacks (candidates: KatArch on Astro, PlaySync on Vite and React) with less than 30 lines of scenario code each, on a machine other than the laptop.

**Phase 4. The blind spots.** `journey`, all-thread accounting, surface naming, `affected`, budgets in CI.
*Done when:* with the commit before the worker move (f59ed47), `journey` reports the shader block with no scenario written for it, and b6329dd reports it as moved, not removed.

**Phase 5. Publish.** npm package, docs site, a case study, the portfolio entry.
*Done when:* the one-sentence test passes with at least two different agents, on a project none of us prepared for it, through `npx` and the public repo.

## Testing the tool

- **Golden traces:** small trace fixtures with known late frames and freezes, run in CI with no browser.
- **A/A and injected costs** as a scheduled self-test on a real Chrome.
- **Trace schema drift.** `PipelineReporter` is a Chrome internal, not an API, and this is the main long-term risk. Pin a tested Chrome range, have `doctor` warn outside it, and keep the parser in one module.

## Risks

| Risk | What happens | Answer |
|---|---|---|
| Chrome changes its trace format | Counts go wrong silently | Fixtures per version, `doctor` checks that a known injected freeze is found |
| Tracing overhead changes the result | Milliseconds run high | Already seen; `--light`, and verdicts come from counts in a lighter trace than dossiers |
| Off-screen windows differ by OS | macOS may not allow it | Checked on Windows only so far; needs a macOS and Linux pass, with a fallback that is reported in the fingerprint |
| Agents treat a verdict as a decision | Trade-offs get settled by a p-value | The tool states evidence. Output never says to merge or to keep a change |
| CI runners are noisy, shared and have no GPU | `compare` is useless there | Be clear: `check` on counted work runs in CI, `compare` needs a real machine |
| Scope creep toward a monitoring product | Unfinished everything | Out of scope: field data, dashboards, cross-machine history |

## Open questions

- License (MIT would be the default for tooling meant to spread).
- Publish under this name? `frameproof` is free on npm as of 2026-11-04. The GitHub name wasn't checked, since `gh` isn't installed here.
- Puppeteer or Playwright for scenarios. Puppeteer is what exists and exposes CDP tracing directly; many projects already write Playwright. Staying on Puppeteer until a real project asks.
- How much of the original history to carry. A clean start with a credit is simpler, and the portfolio stays as its first consumer.

## For the portfolio

The honest pitch is the story of the measuring, not a claim of speed: the wins, the experiments that failed, and the day the tool called a false alarm and got fixed for it. All numbers there come from runs on record. It belongs in the portfolio once phase 3 is done and it runs on something other than the portfolio itself.
