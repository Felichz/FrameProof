# Review: frameproof on the portfolio, on Windows

2026-11-04 and 2026-11-05. An agent used frameproof to find and fix freezes in the portfolio
(`portfolio-felix`), on a Windows 11 laptop (i7-11800H, 100 Hz display), Chrome 156, from a local clone at
`bcde02a`. This is the second review of the same work: read
[the one from the Mac](2026-11-05-portfolio-on-mac.md) first. This page only adds what that one doesn't
have, and says where the two agree or differ. Numbers are late frames a step at 4x unless said otherwise;
runs are in the portfolio's `.frameproof/runs/`.

**Read every number here with point 1 in mind:** all of them were measured in a mode production doesn't
ship in. This agent found that out from the Mac review, after the work below was done.

## In short

`compare` is what made this work trustworthy, and the dossier behind `show <id>` is better than the agent
using it knew: it held the answer to the carousel's stall for hours while three 20-minute `price` runs went
looking for it. The weakest part is everything between "a freeze of 50 ms" and "a number of late frames":
a stutter made of many slightly late frames has no view of its own. The second is that the tool stayed quiet
about things it could see: the serving mode, a dead run, an id it ignored.

## What worked

- **A first result that didn't survive.** A change to `deck.ts` gave `p = 0.038` on `scroll/down`, and the
  confirmation run took it back: `inconclusive`. It wasn't shipped. Claiming it would have been easy.
- **A dossier that led to a fix.** `freezes` named a 129 ms style pass of 381 elements on `window open`. That
  led to a `:has(.thaw)` selector in the CSS. Replaced by an attribute on the root, `compare` against the
  commit before gave `window/open` 30 to 11 and `scroll/down` 23 to 15.5 (`p < 0.001` after Holm), with the
  other four cells `inconclusive` (portfolio commit `026cc45`, run `2026-11-05T15-24-57-8399`).
- **A second `inconclusive` that stopped a change.** Moving two timer writes into a frame looked right on
  paper. `compare` moved no cell (typical frames identical in all six), and it was reverted.
- **`query threads` and `query askers`.** They showed the GPU and the preview's process next to the page's
  main thread, in seconds, from a run already made.

## What to change, most important first

### 1. The serving mode again: confirmed here, and worse than a footnote

The Mac review's point 2 holds on this machine. Every run here served on `127.0.0.1`, so the previews' stages
ran in their own process (`other-site:localhost:60669` in `query threads`). Production has no second origin.
So the `026cc45` result above is proven for a mode visitors don't get, and every carousel number here is
probably lighter than theirs: the Mac saw about 27 against about 49.

The information was on screen the whole time, as a thread named `other-site:localhost:...`, and in the
project's own `CLAUDE.md`. The agent read both and didn't connect them. That is why the Mac's proposal should
go further than a header line: a run that sees a frame from another local origin should say so in `summary`,
where an agent can't skip it, and `compare` should refuse to call a result `better` without naming the mode.

### 2. A stutter has no view of its own

`carousel/next` had 22 to 31 late frames a step, and `freezes` listed one cause for it, in 2 of 4 repetitions.
The rest were too short to make a freeze, so nothing said where they went. Three things were missing:

- **When.** Is a late frame part of the animation the step started, or of something that began after it?
  The answer decides the whole fix, and no output gave it.
- **Which stage, in aggregate.** `counts.causes` is already in `steps.jsonl`, but no command prints it. Added
  up by hand, one `freezes` run showed every late frame as main thread, in all six cells.
- **What the stage means when an iframe is involved.** See point 3.

In progress locally, not pushed yet: `lateTimeline()` keeps each late frame's time and stage and the page's
marks, and `query <run> late` prints them in bins from the action.

### 3. "GPU busy" can name the wrong thing to look at

`GPU busy 100 ms: raster 2 ms, composite 1 ms` reads as a rendering problem, and the agent wrote that it was
probably a recording starting. The dossier said otherwise: the freeze sat at +1110 ms, after
`live:mount:knowgraph` at +922 ms, with the display waiting on a surface of kind `a frame`. So it is a preview
booting after the transition has ended, which the Mac's point 6 and its last paragraph also point at.

Proposed: when the marks or a pending surface explain a freeze better than the GPU's own numbers, the verdict
says that: `waiting on a frame that started 190 ms ago (live:mount:knowgraph)`. And a GPU verdict whose named
parts add up to 3 of 100 ms should say that the time is unexplained, not list the parts.

### 4. `show <run> <id>` ignores the id, silently

`frameproof show 2026-11-05T13-29-34-67d8 f4` prints the whole run. The agent concluded that `show` couldn't
filter, told the person so, and worked without dossiers for hours. The right call is `show f4`, which is in
the `next` of `freezes`, but a run started with `--background` and read through `show <run>` never prints it.

Proposed: accept `<run> <fN>`, or fail with the right command. A second argument that isn't used should never
pass quietly. This cost more than any bug in this review.

### 5. A dead run stays `running` forever

`price` started in the foreground and killed from outside left `2026-11-05T16-38-18-6091` at
`is still running: 256 steps`, hours later. `wait` can't see it: only `--background` runs record
a `pid` (`main.mjs:111`), and the check in `wait.mjs` needs one. `wait` also returns `status: ok` when its
60 minutes run out, the same status as a finished run. Separately, `wait` was seen returning while a run was
still `running`, and the cause wasn't found.

Proposed: every run records its pid; `show` and `wait` report a dead one as `stopped`, with its last step; a
`wait` that times out gets a status of its own.

### 6. `price` is a poor way to search

Each probe took about 21 minutes. Two finished here, both `inconclusive` with intervals wider than the margin; a third, hiding the stage frames, was still running when this was written:

| Probe on `carousel`, 4x | Typical | Interval | Episodes |
|---|---|---|---|
| Slides' `visibility` not inherited | 22 to 21 | -9.14 to 6.18 | 12/48 to 15/48 |
| Cursor light hidden | 24 to 24 | -6.14 to 7.86 | 13/48 to 15/48 |

The Mac priced the cursor light at -4 with `better`. Different machine, different mode or noise: nothing here
can tell which, so the two results shouldn't be averaged. `price` answers "is this worth doing" well, as the Mac
found. It doesn't answer "what is it", and the agent used it that way because of points 2 and 4.

Proposed: `next` should send an agent to dossiers and timelines before `price`, and `price` should take one
speed by default, not `[1, 4]`, which also spends half of its time on a cell nobody asked about.

### 7. `freezes` and episodes use different lines

The Mac's point 1 says deep tracing makes freezes that light runs don't have. This run can't confirm it, and
that is the finding: `freezes` cuts at 50 ms and episodes at 100 ms. Scroll showed a 50 to 60 ms cause in 3 of 4
under deep tracing and 0/24 episodes in `compare`, and both can be true. So the agent reported "scroll is
no longer freezing" from one and could not check it against the other.

Proposed: the same line for both, or both printed side by side, as in the Mac's proposal.

### 8. `compare` can't show that a mechanism worked

A `compare` run keeps no work, so `query forced` is empty. To see whether a change removed the forced style it
aimed at, a separate `freezes` or `ledger` run is needed. The agent skipped that and told the person a change
"lowered the forced style", which was never measured.

Proposed: `ledger --base --head`, one run for the counts of both builds, printed beside the verdict and clearly
labeled as not a verdict.

### 9. Numbers don't carry between runs, and nothing warns about it

Same build, same cell, same day: `carousel/next` typical was 31.5 and 29 in `compare`, 22 and 24 in `price`. Only
the comparison inside a run holds. That is the design, but an agent quoting a number from an earlier run has
no way to know it. This one did.

Proposed: when a run's base differs a lot from the last run of the same build and cell, say so.

### 10. Small ones

- The build cache's key doesn't include `build.env`: `worktreeKey()` hashes HEAD and changed files only. Adding
  `SOURCEMAP: '1'` kept serving the old build, with no source names, until the cache was deleted by hand.
- `--help` on a command doesn't help: `freezes --help` says `which scenario?`, `price --help` says what it needs.
- Stopping a run can leave its `npm run build` alive, which then holds the cache folder (`EBUSY` on the next run).
- Fixed in `bcde02a`: Git's `tar` on Windows reads `C:\...` as a remote host, the export failed silently, and npm
  then walked up and built the working tree, so `compare --base HEAD` compared a build with itself.

## Results on the portfolio, so far

All at 4x, on `127.0.0.1`: not the mode production ships in (point 1).

| Change | Cells | Verdict |
|---|---|---|
| `:has(.thaw)` replaced, deck's reads one frame later, warm-up in slices (`026cc45`) | scroll, carousel, window | better in `scroll/down` and `window/open`; inconclusive in 4 |
| Deck's timer writes moved into a frame | scroll, carousel, window | inconclusive in 5, `same` in 1; reverted |
| Slides' `visibility` not inherited (price) | carousel | inconclusive; not made |
| Cursor light hidden (price) | carousel | inconclusive; not made |

The three changes in `026cc45` were judged together, so the result doesn't say which of them did the work.
Next: the same measurements on `[::1]` at normal speed, which is what the project's goals now ask for.
