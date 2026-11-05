# ADR 0001: Changes from the first two reviews

- **Status:** Accepted, 2026-11-05.
- **Context:** [the Mac review](../reviews/2026-11-05-portfolio-on-mac.md) and [the Windows review](../reviews/2026-11-05-portfolio-on-windows.md),
  both from the same two days of work on the portfolio. Points are cited as M1..M7 and W1..W10.

## Context

Two agents used frameproof on the same project, on two machines, and wrote down what got in the way. They
agree on the most expensive problems, and each found things the other didn't. The problems fall into five
kinds:

1. **What was measured isn't said.** The serving address changed the page's architecture (M2, W1), numbers
   from different runs were quoted together (W9), a changed build environment reused a stale build (W10),
   and nothing said which version of the tool ran (M7).
2. **A freeze means two things.** `freezes` cuts at 50 ms under deep tracing; an episode is a 100 ms run
   of late frames under light tracing. The first found freezes the second never saw (M1, W7).
3. **What isn't a freeze has no view.** A stutter of many slightly late frames shows nowhere (W2), a GPU
   verdict can name the wrong thing when a frame is mounting (W3), and work a setup started is billed to
   the step (M6).
4. **Runs die and lie about it.** A lost browser kills an hour of calibration (M3), a dead foreground run
   stays `running`, and `wait` returns `ok` when it gives up (W5). A stopped run can leave its build
   running (W10).
5. **Commands mislead or cost too much.** `show <run> f4` ignores `f4` (W4), `--help` on a command says
   nothing (W10), `compare` can't show that a mechanism worked (W8), `price` spends half its time on a
   speed nobody asked for and `next` sends agents to it before the dossiers (W6, M4).

## Decisions

### 1. Say what was measured

- **D1. The serving mode is part of every result.** Each step records the local origins whose frames ran
  in another process (`other-site:` threads whose host is `localhost`, `127.0.0.1` or `[::1]`). Every
  command that measures adds a `mode` line to its envelope and to its summary when any were seen:
  `mode: page on 127.0.0.1; frames from localhost ran in their own process`. `compare` and `price` mark a
  cell `invalid` when the two builds ran in different modes. The serving address is set with
  `serve: { static: true, host }` (done in 553db63). *(M2, W1)*
- **D2. Numbers from different runs are flagged.** `compare` and `price` keep each cell's base median per
  machine and build in `.frameproof/cells.json`. When a new run's base differs from the last one by more
  than the margin and by more than a quarter, the cell's reason says so: `the base read 22 here and 31.5 in
  <run>: numbers from separate runs don't compare`. *(W9)*
- **D3. A build's cache key covers how it was built.** The worktree key and the ref keys hash the build
  command and its `env` with the files. *(W10)*
- **D4. The tool says which tool it is.** Every envelope carries `tool: "frameproof 0.1.0 (<commit>[,
  dirty])"`, read from the package and, when it runs from a clone, from git. *(M7)*

### 2. One line for a freeze

- **D5. `freezes` cuts where episodes do.** `--min` defaults to the config's `episodeMs` (100), the same
  line `compare` counts episodes at. A lower `--min` is still allowed, and said in the summary.
  *(W7)*
- **D6. Every freeze group is checked against light runs.** After its deep repetitions, `freezes` runs the
  same scenarios with light tracing (`--light-n`, twice `-n` by default, `0` to skip) and gives each group
  `light: "a/b"`, the share of light repetitions of that step with an episode. A group no light run
  confirms is labeled `deep tracing only`, sorted after the confirmed ones, and left out of the summary's
  count. *(M1, W7)*

### 3. A view for what isn't a freeze

- **D7. Each step keeps its late frames' timeline.** Light and deep steps alike keep, for every late
  frame, its time from the step's act and its stage, and the page's marks in the step. `query <run> late`
  prints them in bins from the act (0-100, 100-300, 300-1000, 1000 ms on) by stage, with the marks that
  fall in each bin; `compare` and `price` add each cell's late frames by stage. *(W2)*
- **D8. Verdicts say when a frame was waiting on something new.** When a freeze waited on a surface of
  kind `a frame` and a page mark or a frame's navigation began within the 500 ms before it, the verdict
  says `waiting on a frame that started <n> ms before (<mark>)`. A GPU verdict whose named parts are under
  a third of its busy time says how much is unexplained instead of listing the parts alone. *(W3)*
- **D9. A step says when it began on a page that wasn't idle.** Before a step acts, the runner waits until
  the page has had no long task for 500 ms (up to 5 s; `quiet: false` on a step or scenario turns it off),
  and a step that began anyway says so: `the page was still busy when the step began (n long tasks in the
  last second)`. *(M6)*

### 4. Runs that survive, and tell their state

- **D10. Every run records its process, and a dead one reads as `stopped`.** Foreground runs record their
  `pid` too. `show`, `wait` and `journal` read a `running` run whose process is gone as `stopped`, with
  its last step. `wait` that runs out of time returns status `running`, not `ok`. *(W5)*
- **D11. A lost browser costs one block, not the run.** A block whose browser goes away (`Connection
  closed`, `Target closed`, `No target with given id`) is run again once in a new browser. If it fails
  again, the session ends and the command reports what it had, as `partial`, rather than an error.
  *(M3)*
- **D12. A build doesn't outlive its run.** The build runs in its own process group, which is killed when
  frameproof is interrupted. *(W10)*

### 5. Commands that don't mislead

- **D13. `show <run> <fN>` works, and an argument no command uses is an error.** Each command declares how
  many arguments it takes; extra ones are a usage error that names the right command. *(W4)*
- **D14. `<command> --help` prints that command's part of the guide.** *(W10)*
- **D15. `compare` shows what the change did to the work, beside the verdict.** After the verdict, one
  repetition of each build is counted (`--no-counts` to skip), and the evidence adds the largest changes
  in forced style and layout and in frames asked for, labeled `counted, not a verdict`. *(W8)*
- **D16. `price` runs at one speed, and `next` reads dossiers before pricing.** `price` defaults to `1x`
  (the goals' throttle when it isn't 1x is asked with `--throttle`); after a `freezes` run, `next` points
  at `show`, then `query <run> late`, and at `price` only once a cause is named. *(W6, M4)*

### Already done

- Inline scripts resolve through their own maps; an event is named by its heaviest listener; paths keep
  `src/` (8a28c25). Astro script blocks are named with their line (ec314a2). The static server takes a
  host (553db63). *(M5)*

## Not done, and why

- **Margins learned from the base's own repetitions** (M4). A margin for `same` is the size of a difference
  that matters, a person's threshold, not the machine's noise: learning it from noise would let noise
  decide what counts as no change. Speed comes from D16 (one throttle by default) instead, and
  `calibrate` stays the way to learn what a machine can see.
- **Resuming a run from its steps** (M3). D11 keeps what a run measured and ends it with a result; a
  resume would also have to prove the machine and the build are the same as before, which D2's record
  only starts to do.

## Consequences

- Summaries get one line longer when the mode is worth saying, and `freezes` takes longer by its light
  runs (about the time of `-n` deep repetitions). Both buy the two things the reviews found most
  expensive: measuring a mode the project doesn't ship in, and chasing a freeze no visitor gets.
- `freezes --min` changes its default from 50 to 100 ms. Runs before this ADR aren't comparable with runs
  after it on that count.
- Projects that relied on `price` running `1x` and `4x` pass `--throttle 1,4`.
