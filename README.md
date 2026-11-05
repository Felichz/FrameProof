# frameproof

Frame-level performance evidence for web apps, built to be used by coding agents.

> **Status: 0.1.0, not on npm yet.** Every command below runs, from GitHub: `npx -y github:Felichz/FrameProof next`. Checked on macOS (Chrome 156, an Intel laptop) against the sample app in [`examples/janky-shop`](examples/janky-shop); Windows and Linux runs are still to do. What is done and what isn't, phase by phase, is at the end of [PLAN.md](PLAN.md#status).

## Use it

Tell your agent:

> Use github.com/Felichz/frameproof to find out why scrolling stutters here, and fix it.

That's the whole setup. The agent reads [AGENTS.md](AGENTS.md), runs `npx -y github:Felichz/FrameProof next` in your project, and the tool walks it through the rest, one step at a time. It will come back to you for one thing: which interactions matter most and what you won't trade away.

It works with any agent that has a shell, on a machine with a display and a GPU. Without those (a cloud container, most CI), it can still count work and hold budgets, and it says it can't judge frames.

## The problem

An agent can change code in seconds and has no reliable way of knowing whether the page got smoother. The usual signals fail in specific ways:

- **Average FPS** moves with the machine's load and hides the one 300 ms freeze a visitor actually feels.
- **Lighthouse and Web Vitals** describe page load and single interactions, not whether the frames of a scroll or an animation arrived on time.
- **A DevTools trace** holds the answer, in a file of tens of megabytes that doesn't fit in a context window and was designed for a person with a flame chart.
- **One before and one after** is an anecdote. On a laptop, two runs of the same build differ more than most real fixes do.

So agents either skip measuring or report a number they can't defend.

## What it does

frameproof drives a real Chrome through scenarios you describe, reads the frames Chrome's compositor reports, and answers three questions in a few hundred tokens of JSON:

| Question | Command | Answer |
|---|---|---|
| Did this change make frames better? | `frameproof compare` | A verdict with an effect size and an interval, from alternated builds |
| What exactly froze, and why? | `frameproof freezes`, `frameproof show` | Each freeze with its stage, its cause and its source line, grouped across repetitions |
| Where does the work go, and did a rule break? | `frameproof ledger`, `frameproof check` | Counted work per scenario, and budgets that fail CI |

On the sample app, the scroll handler reads each card's position after writing to the one before. `freezes` names it:

```console
$ frameproof freezes -s journey,scroll,open-cart --throttle 4 -n 2
```

```json
{
 "status": "ok",
 "summary": "4 cause(s) of freezes of 50 ms or more on worktree at 4x CPU; 4 come back in every repetition. ...",
 "evidence": [
  {"id":"f1","where":"scroll down","in":"2/2","ms":"50-83","cause":"page main thread busy 67 ms: layout forced 80 of 4342 objects in 10 passes at /src/sticky-header.js:6, from script at /src/sticky-header.js:4"},
  {"id":"f3","where":"open-cart open","in":"2/2","ms":"117-133","cause":"page main thread busy 133 ms: style forced 2908 elements in 2 passes at /src/cart.js:28 open, from script at /src/cart.js:18 open"},
  {"journey":"2024 ms during scroll setup (no step measures it)","cause":"page main thread waiting on the GPU process 1746 ms (linking shaders: GetProgramiv)"}
 ],
 "next": ["frameproof show f1", "frameproof query <run> forced", "frameproof price --inject 'css:<rules>' -s scroll"]
}
```

With the reads batched into one pass a frame, `compare` judges the change against the last commit:

```console
$ frameproof compare -s scroll --throttle 4 --note "batching the badge reads and writes removes the forced layout"
```

```json
{
 "status": "better",
 "summary": "worktree against HEAD (37b6821), 8 strata in 9.9 min. better: scroll/down@4x, scroll/up@4x.",
 "evidence": [
  {"cell":"scroll/down@4x","verdict":"better","effect":{"lateFrames":-24,"interval":[-25.2,-22.8]},"typical":{"base":24,"head":0},"episodes":"2/24 vs 0/24, p=0.489","n":"24+24","margin":2,"reason":"confirmed on fresh repetitions (typical frames, p<0.001 after Holm)"},
  {"cell":"scroll/up@4x","verdict":"better","effect":{"lateFrames":-19,"interval":[-20.2,-17.8]},"typical":{"base":19,"head":1},"episodes":"0/24 vs 0/24, p=1","n":"24+24","margin":2,"reason":"confirmed on fresh repetitions (typical frames, p<0.001 after Holm)"}
 ]
}
```

*(Real runs on a 2020 Intel MacBook, Chrome 156, cut for length. The rare stalls in `scroll/down` went from 2 of 24 to 0 of 24, which on its own is not significant: p = 0.49. The typical frames carry the verdict.)*

To try it: copy `examples/janky-shop` somewhere, run `npx -y github:Felichz/FrameProof next` in it, and follow what it says.

## What makes it different

- **The verdict can be "I don't know".** `better`, `worse`, `same`, `inconclusive` and `invalid` are separate results. "Not significant" is never reported as "same": that takes an interval inside a stated margin.
- **It checks itself.** Before trusting a comparison it can run the same build against itself, and inject a known cost to prove it would have seen one.
- **Typical frames and rare freezes are measured apart.** A median and a rate of episodes answer different questions, and averaging them together is how a single stall hides or fakes a result.
- **Output is built for a context window.** A short summary first, and a handle to drill into. Traces stay on disk.
- **It refuses to measure a busy machine.** A loaded laptop gives a `not measurable` result, not a bad number.
- **It keeps a journal.** Every experiment, including the ones that failed, lands in a file in your repo, so the next session doesn't try the same dead end.

## Where it comes from

It is extracted from the tooling used to make [my portfolio](https://portfolio-felix-teal.vercel.app/) fluid, where a Claude agent ran the measuring and I decided the trade-offs. Some results from that work, measured with the A/B described here:

- A video page checking the clock on every frame: opening a window went from 17.4 to 11.0 late frames at 4x CPU throttle, closing it from 15.6 to 6.6, both p < 0.001.
- A third-party frame making the page wait on its first paint: 6.7 to 1.3 late frames a step, p < 0.001.
- A 3D model linking its shaders on the main thread as the visitor arrived: 860 ms of script down to 25 ms in the same scene, after moving it to a worker.
- A redesign that looked like an obvious win, flying a window with a transform: measured worse (17.6 to 22.5 late frames, p = 0.008) and dropped.

The tooling also got things wrong, and those cases shaped this design. See [what the original got wrong](PLAN.md#what-the-original-got-wrong).

## Scope

Chromium only, because the data comes from Chrome's compositor trace. Desktop first; Android over remote debugging is a later question. It measures on your machine and compares only within one machine: it is not a monitoring product and doesn't collect field data.

## License

[MIT](LICENSE).
