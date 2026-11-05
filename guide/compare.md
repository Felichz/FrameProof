# Compare and price

## compare

```
frameproof compare --base HEAD --head worktree -s scroll,open-cart --throttle 1,4 --note "<hypothesis>"
```

Two builds alternate in blocks (ABBA), each block a browser of its own, so a drift in the machine falls
on both. Builds are named as refs:

- `worktree`: the files as they are now, uncommitted changes included (the default `--head`). With
  uncommitted changes, `--base` defaults to `HEAD`.
- any git ref: `HEAD`, `main`, `a1b2c3d`, `HEAD~2`. Exported with `git archive`, built in
  `.frameproof/builds/<commit>-<recipe>/`, cached by commit and by how it is built (the build command, its
  `env`, its output folder): the same files built with `SOURCEMAP=1` are another build.
- `dir:<path>`: a folder already built. `url:<url>`: a site already up.

Without `-s`, compare picks the scenarios that run the changed files (see `frameproof affected`).

Options: `--throttle 1,4` (CPU slowdown; the GPU stays as it is), `--minutes 20` (the time budget),
`--batch 4` (repetitions a block), `--margin N`, `--cold` (fresh profiles, for first-visit costs; by
default each build keeps a warm profile, as a visitor's browser does), `--no-counts`, `--no-journal`,
`--background`.

Beside the verdicts:

- `lateBy`: each cell's late frames by the stage that held them, base → head (`main 80%, gpu 15% →
  main 60%, gpu 30%`).
- `counted`: one repetition of each build, counted, and the largest changes in forced style and layout,
  frames and timers asked for and main-thread time, per step. Labeled `not a verdict`: it says where work
  went, and whether the mechanism you aimed at moved; only the verdict says what a visitor gets.
  `--no-counts` skips it.
- `mode`: the serving mode, when the page has local subframes. Two builds whose local frames ran in
  different processes make every cell `invalid`.
- A cell whose base reads unlike the last run of the same build on this machine says so in its `reason`:
  numbers from separate runs don't compare, only the two builds within one run do.
- If the browser goes away, the block runs again in a new one; a second loss ends the session with what it
  measured, as status `partial`.

The verdict for each cell, and the whole comparison's status (the bad news wins), lands in
`perf/JOURNAL.md` with your `--note`. Then `frameproof report <run>` writes it for a person.

## price

```
frameproof price --inject 'css:.hero{display:none}' -s load
```

What a change would be worth before making it: the same build, alternated, with and without an injection.

- `css:<rules>`: a stylesheet, added before the page's own scripts run.
- `js:<file>`: a script, run before the page's own.
- `busy:<ms>`: a known cost, every frame burns that much for 600 ms after the step acts.
- `freeze:<ms>`: one long task 50 ms after the step acts.

A price is an upper bound: the injection removes exactly that cost, the real change may remove less.

It runs at normal speed unless asked (`--throttle 4`, or `1,4`). Use it to say what a named cause is worth,
not to search for one: read the dossier (`show`) and the late frames' timing (`query <run> late`) first.
