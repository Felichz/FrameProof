# Statistics

How a comparison reaches its verdict, in the order things are decided. The code is
`src/core/verdict.mjs` and `src/core/stats.mjs`; `npm run sim` checks it against simulated builds whose
truth is known.

- **Unit.** One repetition of one step, in a fresh page. Builds alternate in blocks, each block in its own
  browser, two blocks of each build (ABBA) a look.
- **Typical cost.** Late frames a step, compared with a permutation test on ranks stratified by block
  (ranks, so one 50-frame stall can't decide it), reported as a Hodges-Lehmann shift with a bootstrap
  interval.
- **Rare episodes.** A repetition with a freeze over `episodeMs` is an episode; rates are compared with
  Fisher's exact test, and "0 of 30" comes with an upper bound.
- **Screening, then confirmation.** Repetitions grow in looks. A look that seems different only earns a
  confirmation run: fresh repetitions, one look, and only that data decides, with Holm's correction across
  everything being confirmed. A first result that doesn't repeat is reported as such: this is the fix for
  a false alarm the original tool printed as "(real)".
- **Same.** Needs the interval inside the margin, with at least 16 repetitions a build. Since it can be
  reached by looking repeatedly, look k uses level 1 - alpha / 2^k.
- **Stopping.** At a verdict for every cell, or at the time budget. A cell stopped by the budget is
  `inconclusive`, with how many repetitions it would take.
