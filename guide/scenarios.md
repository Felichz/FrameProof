# Scenarios

A scenario is what a person does, in steps. It's the one thing a project writes.

```js
// perf/scenarios/open-cart.js
export default {
  name: 'open-cart',
  setup: async ({ page, url }) => {
    await page.goto(url, { waitUntil: 'load' });
  },
  steps: [
    {
      name: 'open',
      act: ({ page }) => page.click('[data-cart-button]'),
      done: ({ page }) => page.waitForSelector('dialog[open]'),
    },
    {
      name: 'close',
      act: ({ page }) => page.keyboard.press('Escape'),
      done: ({ page }) => page.evaluate(() => !document.querySelector('dialog[open]')),
    },
  ],
};
```

- `setup({ page, url, base, state })` runs before each repetition, in a fresh page, unmeasured. `url` is
  the served build plus the config's `path`.
- `act(ctx)` does the step. `ctx.page` is a Puppeteer page: `click`, `keyboard`, `mouse`, `evaluate`.
- `done(ctx)` is required. It resolves (or returns true) once the step really happened; `false` or a
  string (the reason) means not yet, and it is asked again until `doneTimeout` (15 s). It is how a step
  that did nothing is told apart from a step that was fast.
- `ctx.state` is shared between setup and the steps of one repetition.
- Per step, optional: `settle` (ms traced after done, 1200), `before` (ms of quiet before, 400), `timeout`
  (for act, 20 s), `doneTimeout`.
- Per scenario, optional: `margin` (a number, or `{ stepName: number }`), the late frames `same` needs.

`frameproof scenario new <name>` writes a template; `frameproof scenario check <name>` runs it once and
reports each step: an act that threw (a selector found nothing), a done that never came true, a step after
which nothing changed on screen. Check every scenario after changing it: `next` asks for it.

Files may `import { scenario } from 'frameproof'` and `export default scenario('name', { ... })`; it
resolves even when frameproof runs through npx.

## Built in

- `load`: a fresh page loads the url.
- `idle`: the page at rest, untouched, for 3 s: anything it draws or asks for is work nobody asked for.
- `scroll`: most of a screen down with the wheel, then back up (the page, or the container under the
  middle of the viewport).
- `journey`: walks the other scenarios given with it, in order, in one trace from a fresh page, and
  reports every long task wherever it falls, setups and the gaps between steps included. Use it to find
  costs no scenario covers: `frameproof freezes -s journey,load,scroll`.

A project file with the same name replaces a built-in one.

## When a step fails

A failed step is recorded with its kind (`timeout`, `act-error`, `setup`, `skipped`) and reason, retried
once from a fresh page, and the run goes on. Under load a failure is often a slow run; sometimes it's a
real bug (a focused field scrolling the page). In a comparison, a cell whose steps fail in more than a
quarter of its repetitions is `invalid`, and says whether the failures were on the head build only.
