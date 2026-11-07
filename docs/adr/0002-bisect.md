# ADR 0002: Bisect, to find which part of a page holds the frames

- **Status:** Accepted, 2026-11-07.
- **Context:** the portfolio work on the Mac, 2026-11-06 (its `perf/JOURNAL.md`), after
  [ADR 0001](0001-changes-from-the-first-reviews.md).

## Context

Twice on the portfolio a dossier couldn't name a cause, and a bisection by hand did:

- **`carousel/back`.** Three steps, each a `compare` of the code with one part commented out: warming the
  stages (no), warming only while the hand is off the rail (no), the product left behind rewound while
  hidden (yes, 2 to 1 late frames, p < 0.001, its counted layout objects 345 to 152). The dossier had
  only said "layout of 168 objects in /stage".
- **`scroll`.** The dossier said `GPU busy 273 ms, 244 of it in nothing it names`. Hiding the ambient
  background, the videos and the stage frames together took `scroll/down@1x` from 32.5 late frames to 4
  (episodes 14/24 to 1/24); the halves came next.

It works because every step is an A/B in one run, which holds on a noisy machine. It cost: 15 to 25
minutes a step, by hand; three steps lost to sessions that ended; `display:none` names an element but not
what of it costs (its layout, its paint, its animation, its GPU work); and a search for one cause gets
lost when two causes only show together. And the GPU case was a bisection only because the dossier left
the GPU's time unnamed.

## Decisions

- **D1. `frameproof bisect`.** Given a scenario and candidates, it finds which of them holds the frames:
  `frameproof bisect -s scroll --candidates 'hide:.ambient' 'hide:video' 'hide:iframe'`. First all of them
  together: if that isn't `better`, the group doesn't explain the cost, and it says so and stops. Then
  halves, each priced: it follows the half that keeps the gain; when both halves do, there is more than
  one cause and it follows both; when neither does, the cost shows only with them together, and it says
  so instead of guessing. It ends with the culprits, each confirmed once more on a longer run.
- **D2. Candidates name what to take away, finely.** A candidate is an injection (`css:<rules>`,
  `js:<file>`) or a shorthand on a selector, from the coarsest to the finest:
  - `hide:<sel>`: `display: none`, everything about it gone;
  - `invisible:<sel>`: `visibility: hidden`, its layout kept;
  - `still:<sel>`: no animation and no transition;
  - `flat:<sel>`: no shadow, filter, blend mode or background image;
  - `pause:<sel>`: its videos paused (a script, before the page's own);
  - `off:<name>`: sets `window.__frameproof.off` to include `<name>`, for code the project lets be
    switched off (the guide shows the one-line check a project adds).
  `--refine <sel>` takes a culprit found with `hide:` and prices each finer shorthand of it apart, to say
  which of its costs it is.
- **D3. Steer by counted work, confirm by frames.** `--screen work` judges each split by the counted
  work of the scenario's steps (main-thread time and the GPU's), one repetition a side, which takes a
  minute and holds on a busy machine; the culprits it ends with are confirmed in frames. The default,
  `--screen frames`, judges every split by frames.
- **D4. Screening short, confirmation long.** Each split runs with `--minutes 8` at one speed unless
  asked; the confirmation of each culprit with `--confirm-minutes 15`. `--max-steps` (12) bounds the search.
- **D5. A bisection survives its session.** Every split's result is kept in the run as it lands;
  `--resume <run>` takes them up and runs only what is left.
- **D6. Commits too.** `frameproof bisect -s scroll --base <good> --head <bad>` finds the first commit
  between them that makes the scenario `worse`, comparing the good commit with the middle one each step.
- **D7. The GPU's time, named.** A dossier's `gpu` now lists the GPU main thread's own time by task name
  (`gpu.top`), and a GPU verdict whose raster and composite explain little names the largest of those, so
  that "nothing it names" becomes a lead before it becomes a bisection.

## Not done, and why

- **Bisecting source lines automatically** (commenting code out by itself). Which code can be taken out
  without breaking the page is the project's knowledge: `off:<name>` lets the project say it, in one line.
- **A finer statistical search** (several splits at once, group testing). With every step a full A/B, the
  simple halving is already as few runs as the signal allows, and its steps read plainly in the journal.

## Consequences

- A bisection costs about 10 minutes a split with frames, a minute with work. The journal records every
  split as `price` does, so a search that was cut short is still worth its steps.
- The project adds `window.__frameproof?.off?.includes('<name>')` checks only where it wants switches.
