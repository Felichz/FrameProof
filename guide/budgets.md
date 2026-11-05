# Budgets, the ledger and CI

## ledger

`frameproof ledger -s idle,scroll` counts each step's work instead of timing it: style recalculated
(elements), layout (objects), paint, script, GC, style and layout forced from script, frames and timers
asked for, and time per thread. It keeps the least over the repetitions (`-n 3`): a slow run only ever
adds. Counts move little with the load, which makes them good for budgets, and they say where work went.
They don't say whether frames got better; only `compare` does.

`--against <run>` compares with an earlier ledger, thread by thread: time that left the main thread while a
worker gained is reported as `moved`, not `removed`.

## check

```js
// perf/budgets.js
export default [
  { scenario: 'idle', step: 'rest', says: 'at rest, nothing asks for frames', count: (r) => r.rafs, max: 0 },
  { scenario: 'scroll', says: 'scrolling forces no layout', count: (r) => r.forced('layout'), max: 0 },
  { scenario: 'idle', says: 'only the clock asks for timers', count: (r) => r.timers - r.asked('timer', /clock\.js/), max: 0 },
];
```

`r` has the totals (`rafs`, `timers`, `forced`, `styles`, `layouts`, `paints`, `scriptMs`, `styleMs`,
`layoutMs`, `paintMs`, `busyMs`, `styleElements`, `layoutObjects`) and helpers: `r.asked(kind, /where/)`
(kind `rAF` or `timer`), `r.forced(kind, /where/)` (kind `style` or `layout`), where `/where/` matches the
source location. `frameproof check` exits 1 when a rule breaks.

In CI there is usually no display and no GPU: `check` runs headless there and says so. Counted work holds
headless; frames don't, so don't run `compare` in CI.
